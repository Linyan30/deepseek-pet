#!/usr/bin/env python3
"""用鲸鱼娘头像合成应用图标（1024x1024），供 electron-builder 与 README 使用。

输入：src/renderer/assets/pet-girl.png
输出：docs/screenshots/logo.png
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PET = os.path.join(ROOT, "src", "renderer", "assets", "pet-girl.png")
OUT = os.path.join(ROOT, "docs", "screenshots", "logo.png")

SIZE = 1024
RADIUS = 224
FACE_BOX = (150, 70, 370, 290)  # 与 prepare-art.py 里的头像取景一致


def gradient(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    stops = [(0.0, (124, 151, 255)), (0.55, (77, 107, 254)), (1.0, (53, 80, 214))]
    for y in range(size):
        t = y / (size - 1)
        for i in range(len(stops) - 1):
            a, color = stops[i]
            b, color2 = stops[i + 1]
            if a <= t <= b:
                k = (t - a) / (b - a)
                color = tuple(round(color[j] + (color2[j] - color[j]) * k) for j in range(3))
                break
        else:
            color = stops[-1][1]
        draw.line([(0, y), (size, y)], fill=(*color, 255))
    return image


def main() -> int:
    canvas = gradient(SIZE)

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), RADIUS, fill=255)
    canvas.putalpha(mask)

    pet = Image.open(PET).convert("RGBA")
    face = pet.crop(FACE_BOX)
    target = 720
    face = face.resize((target, target), Image.LANCZOS)

    canvas.alpha_composite(face, ((SIZE - target) // 2, (SIZE - target) // 2 + 40))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    canvas.save(OUT)
    print(f"已生成 {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
