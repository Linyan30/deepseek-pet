#!/usr/bin/env python3
"""用本机 Chrome 重新生成 README 截图与应用图标。

前置条件：安装 Chrome / Chromium，Python 3 与 Pillow。
用法：
    python scripts/screenshots.py

生成：
    docs/screenshots/pet.png       宠物窗口（透明背景，2x）
    docs/screenshots/chat.png      聊天窗口
    docs/screenshots/settings.png  设置窗口
    docs/screenshots/logo.png      应用图标源图
    build/icon.png、build/icon.ico、build/tray.png
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
HARNESS = ROOT / "scripts" / "preview.html"

CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]


def find_chrome() -> str:
    for candidate in CANDIDATES:
        if candidate and os.path.isfile(candidate):
            return candidate
    raise SystemExit("找不到 Chrome/Edge，请用 CHROME_PATH 环境变量指定可执行文件路径。")


def render(chrome: str, target: str, width: int, height: int, background: str, scale: int = 2) -> None:
    """渲染指定页面并裁剪成 width x height（按 scale 放大）的图片。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    out = SHOTS / f"{target}.png"

    src = {
        "pet": "../src/renderer/pet.html",
        "chat": "../src/renderer/chat.html?demo=1",
        "settings": "../src/renderer/settings.html",
    }[target]

    url = f"file:///{HARNESS.as_posix()}?src={src}&w={width}&h={height}"

    win_w = max(500, width)
    win_h = max(500, height)

    with tempfile.TemporaryDirectory(prefix="pet-chrome-") as profile:
        args = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-crash-reporter",
            "--hide-scrollbars",
            "--allow-file-access-from-files",
            f"--user-data-dir={profile}",
            f"--force-device-scale-factor={scale}",
            "--virtual-time-budget=3200",
            "--run-all-compositor-stages-before-draw",
            f"--window-size={win_w},{win_h}",
            f"--default-background-color={background}",
            f"--screenshot={out}",
            url,
        ]
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    image = Image.open(out).convert("RGBA")
    image = image.crop((0, 0, width * scale, height * scale))
    image.save(out)
    print(f"已生成 {out.relative_to(ROOT)} ({image.width}x{image.height})")


def main() -> int:
    chrome = find_chrome()
    render(chrome, "pet", 210, 290, "00000000")
    render(chrome, "chat", 380, 540, "ffffffff")
    render(chrome, "settings", 420, 640, "ffffffff")

    # 应用图标：用鲸鱼娘头像合成，再转出 ico / 托盘图
    subprocess.run([sys.executable, str(ROOT / "scripts" / "make-logo.py")], check=True)

    make_icons = ROOT / "scripts" / "make-icons.py"
    subprocess.run([sys.executable, str(make_icons), str(SHOTS / "logo.png")], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
