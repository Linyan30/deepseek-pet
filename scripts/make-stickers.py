#!/usr/bin/env python3
"""从鲸鱼娘立绘生成一套「表情包」贴纸。

每张 300x340：圆形成像 + 白色贴纸描边 + 底部文字气泡 + 角落 emoji 徽章。
输出到 src/renderer/assets/stickers/，并生成 docs/_stickers-sheet.png 方便预览。

依赖：Pillow。
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "src", "renderer", "assets", "pet-girl.png")
OUT_DIR = os.path.join(ROOT, "src", "renderer", "assets", "stickers")

SKIN = (255, 255, 255, 255)
CJK_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
EMOJI_FONT = "C:/Windows/Fonts/seguiemj.ttf"

STICKERS = [
    # id, 取景框(512 坐标系，留出嘴和下巴), 文案, emoji, 文字颜色
    ("happy", (128, 48, 392, 312), "好耶！", "✨", (77, 107, 254, 255)),
    ("love", (138, 58, 382, 302), "抱抱～", "💙", (226, 86, 120, 255)),
    ("sleepy", (132, 52, 388, 308), "困了…", "😴", (99, 116, 180, 255)),
    ("thanks", (104, 44, 416, 356), "谢谢！", "🙏", (53, 80, 214, 255)),
    ("sorry", (140, 62, 380, 302), "对不起…", "💧", (86, 120, 200, 255)),
    ("question", (130, 50, 390, 310), "诶？", "❓", (110, 92, 200, 255)),
    ("wow", (140, 60, 380, 300), "真的假的", "❗", (214, 120, 40, 255)),
    ("cheer", (100, 40, 420, 360), "冲鸭！", "🔥", (226, 86, 120, 255)),
]


def cover(image: Image.Image, box: tuple, size: int) -> Image.Image:
    """按取景框裁剪并缩放到 size，保证铺满。"""
    crop = image.crop(box)
    scale = size / min(crop.width, crop.height)
    resized = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
    left = (resized.width - size) // 2
    top = (resized.height - size) // 2
    return resized.crop((left, top, left + size, top + size))


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def make_sticker(pet: Image.Image, sticker: tuple) -> Image.Image:
    _, box, caption, emoji, color = sticker
    width, height = 300, 340
    circle = 240
    left = (width - circle) // 2
    top = 12
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # 投影
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        (left + 2, top + 8, left + circle + 2, top + circle + 8), fill=(30, 45, 110, 70)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)))

    # 圆形头像 + 白色贴纸描边
    face = cover(pet, box, circle)
    face.putalpha(circle_mask(circle))

    ring = Image.new("RGBA", (circle + 16, circle + 16), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse((0, 0, circle + 15, circle + 15), fill=SKIN)
    canvas.alpha_composite(ring, (left - 8, top - 8))
    canvas.alpha_composite(face, (left, top))

    draw = ImageDraw.Draw(canvas)

    # 底部文案气泡
    font = ImageFont.truetype(CJK_BOLD, 30)
    text_box = draw.textbbox((0, 0), caption, font=font)
    text_w = text_box[2] - text_box[0]
    text_h = text_box[3] - text_box[1]
    pill_w = text_w + 44
    pill_h = text_h + 22
    pill_x = (width - pill_w) // 2
    pill_y = height - pill_h - 6

    pill_shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(pill_shadow).rounded_rectangle(
        (pill_x, pill_y + 4, pill_x + pill_w, pill_y + pill_h + 4), 22, fill=(30, 45, 110, 60)
    )
    canvas.alpha_composite(pill_shadow.filter(ImageFilter.GaussianBlur(5)))
    draw.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h), 22, fill=SKIN)
    draw.text(
        (width // 2, pill_y + pill_h // 2),
        caption,
        font=font,
        fill=color,
        anchor="mm",
    )

    # 右上角 emoji 徽章
    badge_r = 28
    bx, by = width - badge_r * 2 - 2, 4
    draw.ellipse((bx, by, bx + badge_r * 2, by + badge_r * 2), fill=SKIN)
    emoji_font = ImageFont.truetype(EMOJI_FONT, 34)
    draw.text(
        (bx + badge_r, by + badge_r),
        emoji,
        font=emoji_font,
        embedded_color=True,
        anchor="mm",
    )

    return canvas


def main() -> int:
    if not os.path.exists(SOURCE):
        raise SystemExit(f"找不到素材：{SOURCE}")
    pet = Image.open(SOURCE).convert("RGBA")
    os.makedirs(OUT_DIR, exist_ok=True)

    made = []
    for sticker in STICKERS:
        image = make_sticker(pet, sticker)
        image.save(os.path.join(OUT_DIR, f"{sticker[0]}.png"))
        made.append(image)

    sheet = Image.new("RGB", (4 * 320, 2 * 372), (238, 241, 250))
    for index, image in enumerate(made):
        x = (index % 4) * 320 + 10
        y = (index // 4) * 372 + 12
        sheet.paste(image, (x, y), image)
    sheet_path = os.path.join(ROOT, "docs", "screenshots", "stickers.png")
    os.makedirs(os.path.dirname(sheet_path), exist_ok=True)
    sheet.save(sheet_path)

    print(f"已生成 {len(made)} 张表情包 -> src/renderer/assets/stickers/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
