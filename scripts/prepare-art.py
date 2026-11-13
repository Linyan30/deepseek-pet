#!/usr/bin/env python3
"""把用户提供的「鲸鱼娘」插画处理成桌面宠物素材。

做三件事：
1. 用从边缘泛洪的方式去掉纯白背景（保留角色内部的白色）；
2. 去掉左上角自带的 "token来" 对白气泡，避免和程序自己的气泡打架；
3. 输出正方形宠物图与圆形头像，边缘做轻微羽化。

依赖：Pillow、numpy、scipy（仅生成素材时需要，运行应用不需要）。

用法：
    python scripts/prepare-art.py <原图>

输出：
    src/renderer/assets/pet-girl.png     512x512 透明背景
    src/renderer/assets/avatar-girl.png  128x128 圆形头像
    docs/_art-preview.png                深色背景预览，方便肉眼检查边缘
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "src", "renderer", "assets")

# 自带气泡：先找出气泡内部，再沿着描边把整个气泡吃掉（避免方形裁切切到头发）
BUBBLE_REGION = (0, 0, 490, 430)  # left, top, right, bottom

# 头像取景（512 宠物图坐标，正方形）
AVATAR_BOX = (150, 70, 370, 290)


def bubble_mask(source: Image.Image, threshold: int = 40) -> np.ndarray:
    """精确找出左上角 "token来" 气泡的像素，返回全图布尔掩码。"""
    rgb = np.asarray(source.convert("RGB")).astype(np.int16)
    left, top, right, bottom = BUBBLE_REGION
    sub = rgb[top:bottom, left:right]

    near_white = np.abs(255 - sub).max(axis=2) <= threshold
    labels, count = ndimage.label(near_white)

    # 气泡内部是不和选区边缘相连的最大白色块；和外框相连的白色都是背景
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    best_label = 0
    best_area = 0
    for index in range(1, count + 1):
        if index in border_labels:
            continue
        area = int((labels == index).sum())
        if area > best_area:
            best_label = index
            best_area = area

    if not best_label or best_area < 5000:
        raise SystemExit("没有找到气泡内部的白色区域")

    interior = labels == best_label
    filled = ndimage.binary_fill_holes(interior)  # 把文字、装饰一起填掉

    # 气泡描边是深蓝色，只吃掉紧贴气泡内部、且落在安全范围内的深蓝像素
    grown = ndimage.binary_dilation(filled, iterations=12)
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    navy = (b > r + 8) & (b > g + 4) & (b < 200)

    height, width = filled.shape
    yy, xx = np.mgrid[0:height, 0:width]
    xs = xx + left
    ys = yy + top
    safe = np.where(ys < 200, xs < 468, np.where(ys < 300, xs < 462, np.where(ys < 350, xs < 448, xs < 405)))

    mask = filled | (grown & navy & safe)

    # 描边外侧 2px 的抗锯齿浅色也一起清掉
    mask |= ndimage.binary_dilation(mask, iterations=2) & near_white

    full = np.zeros(rgb.shape[:2], dtype=bool)
    full[top:bottom, left:right] = mask
    return full


def cutout(source: Image.Image, threshold: int = 30) -> Image.Image:
    """从四边泛洪去掉白底，得到 RGBA。"""
    rgb = np.asarray(source.convert("RGB")).astype(np.int16)
    height, width = rgb.shape[:2]

    # 和纯白差异很小的像素才算背景，避免误伤浅色衣服
    distance = np.abs(255 - rgb).max(axis=2)
    near_white = distance <= threshold

    # 从四周向内做一次连通标记（BFS），只有连到画布边缘的白色才算背景
    background = np.zeros((height, width), dtype=bool)
    stack = []

    for x in range(width):
        for y in (0, height - 1):
            if near_white[y, x] and not background[y, x]:
                background[y, x] = True
                stack.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if near_white[y, x] and not background[y, x]:
                background[y, x] = True
                stack.append((y, x))

    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and near_white[ny, nx] and not background[ny, nx]:
                background[ny, nx] = True
                stack.append((ny, nx))

    alpha = np.where(background, 0, 255).astype(np.uint8)

    # 清掉自带的气泡
    alpha[bubble_mask(source)] = 0

    # 边缘白色残留：紧贴透明区域、且本身很白的像素，再吃掉几层
    for _ in range(3):
        transparent = alpha == 0
        whiteish = (np.abs(255 - rgb).max(axis=2) <= 46)
        near_transparent = (
            np.roll(transparent, 1, axis=0)
            | np.roll(transparent, -1, axis=0)
            | np.roll(transparent, 1, axis=1)
            | np.roll(transparent, -1, axis=1)
        )
        alpha[near_transparent & whiteish] = 0

    # 去掉零散的小像素点（气泡描边残留、JPEG 噪点）
    labels, count = ndimage.label(alpha > 20)
    if count:
        sizes = ndimage.sum(alpha > 20, labels, range(1, count + 1))
        for index, area in enumerate(sizes, start=1):
            if area < 60:
                alpha[labels == index] = 0

    rgba = np.dstack([rgb.astype(np.uint8), alpha])

    # 轻微羽化，缩放后边缘更自然
    alpha_image = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.7))
    rgba[:, :, 3] = np.asarray(alpha_image)
    return Image.fromarray(rgba, "RGBA")


def fit_square(image: Image.Image, size: int, padding_ratio: float = 0.04) -> Image.Image:
    """裁掉透明边，等比缩放并居中放进正方形画布。"""
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)

    inner = int(size * (1 - padding_ratio * 2))
    scale = min(inner / image.width, inner / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


def circle_avatar(image: Image.Image, size: int = 128) -> Image.Image:
    square = image.crop(AVATAR_BOX)
    square = square.resize((size, size), Image.LANCZOS)

    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    square.putalpha(mask)
    return square


def preview(art: Image.Image, path: str) -> None:
    """把宠物图放到深色/浅色背景上，方便检查白边。"""
    canvas = Image.new("RGBA", (760, 300), (0, 0, 0, 255))
    dark = Image.new("RGBA", (370, 300), (26, 27, 31, 255))
    light = Image.new("RGBA", (370, 300), (243, 245, 255, 255))
    pet = art.resize((260, 260), Image.LANCZOS)
    canvas.paste(dark, (0, 0))
    canvas.paste(light, (380, 0))
    canvas.alpha_composite(pet, (55, 20))
    canvas.alpha_composite(pet, (435, 20))
    canvas.convert("RGB").save(path, quality=92)


def main() -> int:
    source_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs", "_art-source.jpg")
    source = Image.open(source_path).convert("RGB")

    cut = cutout(source)

    os.makedirs(ASSETS, exist_ok=True)
    art = fit_square(cut, 512)
    art.save(os.path.join(ASSETS, "pet-girl.png"))

    avatar = circle_avatar(art)
    avatar.save(os.path.join(ASSETS, "avatar-girl.png"))

    preview(art, os.path.join(ROOT, "docs", "_art-preview.png"))

    print("已生成 pet-girl.png（512）、avatar-girl.png（128）与 docs/_art-preview.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
