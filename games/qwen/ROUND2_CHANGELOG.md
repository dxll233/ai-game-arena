# ROUND2_CHANGELOG — 《问道2048·修仙录》v1 → v2

日期：2026-11-02 ｜ 范围：仅 `问道2048/` 项目目录 ｜ 裁判指导文件未改动

## 一、新增

1. **试炼秘境：6 个固定挑战盘**（`index.html` 常量 `CHALLENGES`）
   - 每盘含名称、规则说明、固定初盘、目标值、限步（或不限）、固定随机种子（c3 禁用落子）。
   - 选关面板：6 张卡片 + 通关徽章（"已通关·最佳N步" / "未通关"），可反复重试。
   - 挑战信息条：对局中显示盘名 / 目标 / 余步。
   - 限步耗尽独立结算"劫数已尽"（nomoves），与死局"道消身陨"区分。
2. **法术系统：2 种有代价法术**（`SPELLS`、`applySpell`、`castSpell`）
   - 每局 3 点灵气（灵珠 UI）；乾坤挪移（1 灵 / 调息 2 步 / 种子随机 Fisher-Yates 重排牌位）；
     焚天化劫（2 灵 / 调息 3 步 / 随机移除一张最小值牌）。
   - 边界：调息期内同法术不可连发；牌数 <2 不可施法；失败施法零副作用、不入撤销历史；
     重排后若成死局同样进入失败结算。施法成功进入同一撤销历史。
3. **纪录隔离与迁移**：经典巅峰沿用 v1 键 `wd2048_best`（旧存档天然迁移）；
   挑战通关独立键 `wd2048_challenges_v1`（`{盘id:{cleared,bestMoves}}`）；挑战得分不覆盖经典巅峰。
4. **可注入种子的随机源** `Random`（mulberry32）：挑战盘固定种子可复现；撤销恢复 `rngState`。
5. **纯逻辑入口** `applyMove` / `settleAfterMove`：同步、无动画时序依赖，供测试与表现层共用。
6. **调试/测试钩子隔离** `window.__wd2048`：写操作（setGrid/startClassic/startChallenge/castSpell/
   applySpellRaw/seed/continueAfterWin）置 `officialRun=false`，禁止写纪录与通关证据；`getState` 只读。
7. **测试基建**：`tests/harness.mjs`（Node vm 沙箱无头逻辑测试，21 项）、
   `tests/browser_round2.mjs`（playwright-core 驱动系统 Chrome，24 项 + 截图）、
   `tests/v1_original_for_regression.html`（v1 源码只读备份，回归证据）、`tests/reference_solutions.json`（六盘参考解）。
8. **内联 SVG favicon**（自制素材，data URI）：消除浏览器默认请求 /favicon.ico 的 404 控制台错误。

## 二、修复

1. **P0 终局缺陷（第一轮评分报告确认缺陷 1）**：胜利结算"继续修行"后，若盘面无合法步，
   v1 因无效移动提前返回而永久无法进入失败结算（卡死）。v2 三层保障：
   `settleAfterMove` 结算优先级（挑战达成 > 首次飞升 > 死局 > 限步耗尽）、
   继续按钮回调内立即检查 `canMove()`、无效移动安全网 `onInvalidMove()`。
   复现与修复证据：`node tests/harness.mjs tests/v1_original_for_regression.html`（Q1a 未通过=修复前）
   与 `node tests/harness.mjs`（Q1a 通过=修复后）。
2. **P0 撤销快照不完整（确认缺陷 2）**：v1 快照仅 `values/score`，撤销不恢复 `wonShown`
   （撤销后仍视为"已弹过飞升"）。v2 快照扩展为 12 字段（含 mode/wonShown/keepPlaying/highest/
   lingqi/cdShift/cdDissolve/movesLeft/movesUsed/rngState），Q2a–Q2g 逐项断言。
3. **v2 开发期自查缺陷（回归测试先行暴露）**：重构初期 `applyMove` 在移动循环**之后**才压栈快照，
   而循环已原地修改棋盘，导致撤销还原出"移动后"状态（Q2a/b/c/f 失败）。
   修复：函数开头捕获快照，`!moved` 时直接返回不压栈。先展示失败、后验证修复。
4. **favicon 404**：浏览器实测 B8/B18/B21/B24 捕获 "Failed to load resource: 404"，
   定位为缺少 favicon；以内联 SVG 修复后 24/24 通过。

## 三、兼容变化

1. **旧存档**：v1 的 `wd2048_best` 原键原语义保留，v2 首次加载即读入为经典巅峰（Q4-records 验证迁移）。
2. **启动入口不变**：仍为双击/打开 `index.html`；主界面默认经典修仙模式，v1 玩家流程零学习成本。
3. **文档口径修正**：v1 文档写"动画 120ms / 容器 min(92vw,420px)"，与 v1 源码实际（130ms / min(94vw,440px)）
   不符；v2 文档统一按源码实际值书写。
4. **开发期依赖**：`tests/browser_round2.mjs` 需要 `playwright-core`（仅测试用，游戏本体零依赖）。
   稳定安装：项目目录内 `npm i -D playwright-core`（不下载浏览器，驱动系统已装 Chrome/Edge：
   脚本用 `chromium.launch({ channel: "chrome" })`）。
5. **挑战盘参数在开发期调优**（未发布过，不构成玩家兼容问题）：c2 限步 60→80→100、
   c4 初盘与限步（50→70→90）、c5 初盘重排、c6 初盘加值与限步（120→160）。
   调优依据：初盘总值 + 限步×期望落子值(2.2) 必须 ≥ 目标值 + 终局残牌余量；
   旧 c6 盘（初盘总值 1648、限步 120 → 期望总值 1912 < 2048）经核算数学上不可解，已修正。

## 四、保留限制（如实披露）

1. 无中途存档/读档：仅有跨局纪录（巅峰、通关徽章）；刷新页面从新局开始（与 v1 一致）。
2. 无暂停功能：回合制玩法无实时压力，失焦/切回不影响状态（浏览器实测 B5 验证）。
3. 经典模式 2048 胜利仍依赖玩家真实对局；自动化仅用于挑战盘内容验收与回归，
   参考解（`reference_solutions.json`）明确标注"非手动通关证据"。
4. 触屏验收为浏览器级触摸事件模拟（playwright touch 上下文 + 真实 TouchEvent），**非实体手机**。
5. FPS 采样为 headless Chrome 下 rAF 计数（2000ms），不代表所有真机表现；未测环境不声称 60FPS。
6. 音效为 WebAudio 合成，无音频输出环境自动静音；未做真机外放验收。

## 五、素材来源与许可

| 素材 | 来源 | 许可 |
| --- | --- | --- |
| 全部代码/CSS/文案 | 本项目自研 | 自有 |
| favicon（内联 SVG：玄底金环"道"字） | 本项目自绘 data URI | 自有 |
| 音效 | WebAudio 振荡器实时合成，无音频文件 | 自有 |
| 字体 | 系统字体栈（PingFang SC / Microsoft YaHei / KaiTi 等） | 系统自带 |
| 图片/外部库/网络资源 | 无 | — |

## 六、2026-11-05 交付补充（不改动游戏代码）

1. **A0 独立备份落地**：`../版本备份/第一期原版-20261105-153633/`（目录）+ 同名 ZIP。
   内容为第一期原版 `index.html`（SHA256=`2D3500D35F6F47CDEE8DCA13665AABE8B9A810DBACD351A846BF30322FD8E353`，
   与裁判《评审记录/源码哈希清单.json》第一轮基线逐字节一致）+ 备份说明 + v2 文档快照（v1 文档原文已被
   v2 原地覆盖、不可恢复，如实披露）。副本经 `tests/verify_backup.mjs` 实跑验证 5/5（启动/键盘12步/撤销/重开/无异常）。
   清单与恢复方法：`BACKUP_MANIFEST.md`。时序如实：备份建立晚于 v2 开发，源为动工前保存的只读副本。
2. **A8 玩家发布版**：`发布版/`（index.html、启动游戏.bat、玩家操作说明.md、README.txt）与
   `问道2048-修仙录-v2-玩家版.zip`（SHA256=`73C74A7BA5CE5850E3EC0F2C4200D3564389A38606257C40CF79A3A6F60C0E5B`）。
   复制到干净临时目录后 http 与 file://（双击等价）双入口各 6/6 通过（`tests/verify_release.mjs`）。
3. **新增交付文档**：`玩家操作说明.md`、`已知问题.md`、`BACKUP_MANIFEST.md`；
   `TEST_REPORT_ROUND2.md` 增补 §8（2026-11-05 全套复跑：逻辑 21/21、v1 回归按设计复现、浏览器 24/24、
   备份 5/5、发布版 6/6×2）与 A0—A8 终表。
4. **新增验证脚本**（仅测试用）：`tests/verify_backup.mjs`、`tests/verify_release.mjs`；游戏本体零改动
   （发布版 index.html 与开发版哈希一致：`E53CB423BB4C39FE8B8006CB9726AE735D35D51CD2EBA99CD1DFC322D2408F16`）。
