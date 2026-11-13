# 素材与版权说明（Art Notice）

本项目把「代码」和「美术素材」分开授权：

| 内容 | 位置 | 授权 |
| --- | --- | --- |
| 程序代码、界面、脚本 | `main.js`、`preload.js`、`src/`、`test/`、`scripts/`、`.github/` | MIT（见 [LICENSE](../LICENSE)） |
| 简约小鲸鱼 SVG | `src/renderer/pet.html`、`src/renderer/assets/avatar.svg` | 随代码以 MIT 提供（本项目原创绘制） |
| 二次元鲸鱼娘立绘 | `src/renderer/assets/pet-girl.png`、`avatar-girl.png`、`docs/screenshots/logo.png` | **不在 MIT 范围内**，由使用者提供 |
| 表情包贴纸 | `src/renderer/assets/stickers/*.png` | 由上述立绘裁切、加文字生成，同样**不在 MIT 范围内** |

## 关于鲸鱼娘立绘

- 这张二次元立绘（蓝色长发、女仆装、抱着笔记本的鲸鱼娘）由项目使用者提供，
  项目维护者不主张其版权，也无法代为授权。
- 如果你要**公开仓库或分发安装包**，请先确认自己拥有该图片的分发权，
  或者先把它换成你自己绘制/购买的素材。
- 需要完全规避素材风险时，可以：
  1. 在设置里切换成「简约小鲸鱼」，并删除 `pet-girl.png`、`avatar-girl.png` 和 `stickers/` 目录；
  2. 或用自己的图运行 `python scripts/prepare-art.py 你的图.png` 重新生成素材与表情包。
- 所有处理脚本（`scripts/prepare-art.py`）只做**去白底、裁掉自带对白气泡、缩放**，
  不修改原画内容，也不会把图片上传到任何服务器。

## 名称与商标

「DeepSeek」名称与商标归其所有者所有。本项目是爱好者作品，与 DeepSeek 官方没有隶属关系，
也未内置任何官方 Logo 或官方素材。
