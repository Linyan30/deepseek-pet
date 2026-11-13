#!/usr/bin/env python3
"""把一张方形 PNG（由 assets/logo.svg 渲染而来）生成 Windows/macOS/Linux 需要的图标。

用法：
    python scripts/make-icons.py [源 PNG，默认 docs/screenshots/logo.png]

输出：
    build/icon.png   512x512
    build/icon.ico   多尺寸
    build/tray.png   32x32（托盘）
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs", "screenshots", "logo.png")
BUILD = os.path.join(ROOT, "build")


def main() -> int:
    if not os.path.exists(SOURCE):
        print(f"找不到源图：{SOURCE}", file=sys.stderr)
        return 1

    os.makedirs(BUILD, exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")
    size = min(image.size)
    left = (image.width - size) // 2
    top = (image.height - size) // 2
    image = image.crop((left, top, left + size, top + size))

    icon_1024 = image.resize((1024, 1024), Image.LANCZOS)
    icon_1024.save(os.path.join(BUILD, "icon.png"))

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon_1024.save(os.path.join(BUILD, "icon.ico"), format="ICO", sizes=ico_sizes)

    tray = image.resize((32, 32), Image.LANCZOS)
    tray.save(os.path.join(BUILD, "tray.png"))
    tray.save(os.path.join(ROOT, "src", "renderer", "assets", "tray.png"))

    print(f"已生成：build/icon.png（1024）、build/icon.ico（{len(ico_sizes)} 种尺寸）、build/tray.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
