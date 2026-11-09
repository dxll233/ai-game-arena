# AI 游戏竞技场

八个 AI 开发团队的浏览器小游戏合集，收录可玩的源码、实机截图、设计与开发记录，以及部分原始测试工具。

**[打开游戏大厅](https://ai-game-arena-fans.surge.sh/)** · [第二轮比赛通用提示词](docs/第二轮比赛通用提示词.md) · [开发与测试说明](docs/开发与测试.md)

| 游戏 | 开发 AI | 收录版本 | 游玩 | 源码与过程 |
| --- | --- | --- | --- | --- |
| [长夜点灯](games/deepseek/) | DeepSeek | 2.0.0 | [触屏可尝试，在线试玩](https://ai-game-arena-fans.surge.sh/games/deepseek/) | [入口](games/deepseek/index.html) · [截图](games/deepseek/preview.png) · [第二轮变更](games/deepseek/ROUND2_CHANGELOG.md) |
| [星港守夜人](games/kimi/) | Kimi | 第二轮修复版 | [触屏可尝试，在线试玩](https://ai-game-arena-fans.surge.sh/games/kimi/) | [入口](games/kimi/index.html) · [截图](games/kimi/preview.png) · [第二轮变更](games/kimi/ROUND2_CHANGELOG.md) |
| [墨影·守夜人](games/mimo/) | MiMo | 当前版 | [推荐电脑键鼠，在线试玩](https://ai-game-arena-fans.surge.sh/games/mimo/) | [入口](games/mimo/game/index.html) · [截图](games/mimo/preview.png) · [第二轮变更](games/mimo/ROUND2_CHANGELOG.md) |
| [星尘幸存者](games/doubao/) | 豆包 | 2.0 | [推荐电脑键鼠，在线试玩](https://ai-game-arena-fans.surge.sh/games/doubao/) | [入口](games/doubao/index.html) · [截图](games/doubao/preview.png) · [第二轮变更](games/doubao/ROUND2_CHANGELOG.md) |
| [回响 ECHO](games/hunyuan/) | 混元 | 15 关·终章守卫版 | [触屏可尝试，在线试玩](https://ai-game-arena-fans.surge.sh/games/hunyuan/) | [入口](games/hunyuan/index.html) · [截图](games/hunyuan/preview.png) · [第二轮变更](games/hunyuan/ROUND2_CHANGELOG.md) |
| [霓虹防线](games/step/) | 阶跃 | 3.0.1 | [触屏可尝试，在线试玩](https://ai-game-arena-fans.surge.sh/games/step/) | [入口](games/step/index.html) · [截图](games/step/preview.png) · [第二轮变更](games/step/ROUND2_CHANGELOG.md) |
| [御剑·破晓](games/zhipu/) | 智谱 | 2.0 | [推荐电脑键鼠，在线试玩](https://ai-game-arena-fans.surge.sh/games/zhipu/) | [入口](games/zhipu/index.html) · [截图](games/zhipu/preview.png) · [第二轮变更](games/zhipu/ROUND2_CHANGELOG.md) |
| [问道2048·修仙录](games/qwen/) | 千问 | 2 | [触屏可尝试，在线试玩](https://ai-game-arena-fans.surge.sh/games/qwen/) | [入口](games/qwen/index.html) · [截图](games/qwen/preview.png) · [第二轮变更](games/qwen/ROUND2_CHANGELOG.md) |

## 本地游玩

下载或克隆仓库，在仓库目录中运行以下命令。游戏使用原生 HTML、CSS 和 JavaScript，画面和音效由程序生成，字体使用系统字体。游玩无需安装项目依赖。

```sh
python -m http.server 8000 --bind 127.0.0.1
```

把表中「入口」对应的文件路径接在 `http://127.0.0.1:8000/` 后，在浏览器中打开。例如，长夜点灯的本地入口为 `http://127.0.0.1:8000/games/deepseek/index.html`，墨影·守夜人的入口为 `http://127.0.0.1:8000/games/mimo/game/index.html`。多数游戏也支持双击入口文件直接打开。存档和设置由各游戏保存在当前浏览器。

## 开发资料

每款游戏目录附有第二轮开发指导、变更记录和开发或设计文档。截图取自游戏本身，用来展示画面。测试报告是各开发阶段的原始记录，保留其中的覆盖范围和已知问题。

公开版本收录独立游戏和开发资料。线上评分和作品榜单在游戏大厅提供。

本仓库的项目代码与随附文档采用 [MIT 许可证](LICENSE)。作品与开发 AI 的对应关系见上表。
