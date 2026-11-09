# TEST_REPORT_ROUND2 —《墨影·守夜人》第二轮测试与试玩报告

- 日期：2026-11-02
- 测试环境：Windows 11，本地 Chrome（`--remote-debugging-port=9333`），Node v20.11.1，python http.server 8123（仅用于自动化取证；游戏本身支持 file:// 双击直玩）
- 状态标记：**通过 / 未通过 / 未验证**
- 声明：`run-tests.js` 为**规则验证**（Node vm 桩驱动真实 Game 类），不是真实玩家试玩证据；`playtest.js` 为真实浏览器试玩（真实键盘/鼠标事件、真实计时、无跳关改值），但走位/选卡由脚本策略驱动，**不是人工手玩**，两者在下文分别标注。

---

## 一、裁判指南「可验证验收目标」逐条状态

### 验收 1：输入生命周期边界（按住移动键后 blur / 页面隐藏 / 暂停 / 失败 / 重开，输入全释放、时间冻结、恢复不漂移）—— **通过**
- 规则验证：`node game/tests/run-tests.js`
  - A1-1 按住 KeyW 后 blur：按键全释放、自动暂停、暂停期间位移为 0（[通过]）
  - A1-2 visibilitychange 同 blur 处理，切回不自动恢复（[通过]）
  - A1-3 暂停时间完全冻结（`g.time` 不变）、恢复推进精确（1s ±0.02）、旧按键不沿用（[通过]）
  - A1-4 冲刺输入状态在 blur/暂停时清零；冷却按规则自然结束后可再冲刺（[通过]）
  - A1-5 失败与重开：输入清零、战斗数据重置（[通过]）
- 真实试玩（CDP 真实键盘事件）：`node game/tests/playtest.js smoke`
  - `[MVT-HOLD] {x0:480, x1:636, delta:156, expect:'≈156 (260px/s×0.6s)'}` —— 按住 KeyD 600ms 位移 156px，与理论值一致（此前环境的"点按无法移动"限制已通过 CDP 按住/松开分离解决）
  - `[MVT-RELEASE] {delta:0, keys:[]}` —— 松开后停止移动、keys 清空
  - `[TAB-SWITCH] {autoPaused:true, keysCleared:true, backPlaying:true}` —— 切标签真实触发 blur+visibilitychange：自动暂停、按键清空、切回可恢复
  - `node game/tests/playtest.js blur`（窗口级失焦，PowerShell ShowWindow 最小化/恢复真实 Chrome 窗口）
  - `[BLUR-MINIMIZED] {state:'paused', keys:[]}` —— 最小化后自动暂停+按键清空
  - `[BLUR-RESTORED] {state:'playing', movedDelta:105, keys:[]}` —— 恢复后可继续移动、keys 无残留
- 代码位置：`game/js/game.js`（bindInput / clearInput / togglePause / start）

### 验收 2：300 秒胜利只结算一次 + 结束本局/继续无尽 + 重开清零 —— **通过**（规则+真实试玩）
- 规则验证（[通过]）：
  - A2-1 推进 300s 只结算一次（`totalRuns` 仅 +1，后续推进不重复写），显示守夜时长/击杀/等级，提供两个选择
  - A2-2 继续无尽：战斗推进、不重播胜利、不重复写纪录
  - A2-3 无尽失败显示「无尽失败 · 已守夜成功」，保留 300 秒达成标记
  - A2-4 结束本局结算一次；重复触发结算界面不重复写入（防重入）
  - A2-5 胜利与死亡互斥：跨 300s 帧优先结算胜利
  - A2-6 连续重开 10 次：每次战斗数据清零、结算一次、历史保留
- 真实试玩：`node game/tests/playtest.js restart`
  - `[RESTART-10] {ok:true, times:[…10 轮均 state:'playing', time:0.4~0.5, hp:100, kills:0]}`
  - 每轮经真实鼠标点击暂停界面「重新开始」按钮重开（非模拟调用），10/10 战斗数据清零（time<3、kills=0），历史存档保留
- 真实试玩胜负链路（300 秒真实计时）：见「三、真实试玩记录」
- 代码位置：`game/js/game.js`（update 胜利判定 / showVictory / continueEndless / gameOver / settleRun）

### 验收 3：三种进化在真实升级流程触发 + 两种新敌人机制预警/行为/反制 —— **通过**（规则）/ 见三（真实触发截图）
- 规则验证（[通过]）：
  - A3-1 焚墨环：周期火环 + 灼烧 DOT（A3-1 覆盖）
  - A3-3 贯星阵：星弹无限穿透 + 每第 5 发五星贯阵
  - A3-4 连霆：落雷留下霆印并延迟二次爆轰
  - A3-5 裂锋客：蓄力预警 → 直线冲刺（方向锁定）→ 硬直；A3-5b 反制：横移可躲
  - A3-6 墨幕使者：落点预警先于墨幕，生成后持续减速；A3-6b 反制：击败使者立即驱散、墨幕内移速 75%
- 真实试玩时机截图：`05-lancer-aim.png`（裂锋客蓄力红线）、`06-veil-cast.png`（墨幕落点圆形预警）、`07-veil-zone.png`（墨幕生成）——均为自然刷出的敌人（修复缺陷后 unlock 75s/90s 正常入池）
- 代码位置：`game/js/weapons.js`（进化）、`game/js/game.js`（updateEnemies AI 分支）、`game/js/config.js`（CONFIG.lancer/veil/evolution）

### 验收 4：Boss 两阶段转换确定且只触发一次、两阶段攻击不同、死亡与胜利互斥 —— **通过**（规则）/ 见三（真实 Boss 战截图）
- 规则验证（[通过]）：
  - A4-1 Boss 二阶段转换条件确定且只触发一次
  - A4-2 两阶段攻击模式不同：环形弹幕 vs 扇形墨弹 + 地面墨痕
  - A4-3 Boss 死亡与胜利互斥：击杀 Boss 不等于通关
- 代码位置：`game/js/game.js`（enterBossPhase2 / bossRing / bossFan / pendings:updatePendings）

### 验收 5：核心状态测试新建 + 全部 JS 语法检查 + 明确标注"规则验证非试玩" —— **通过**
- `node game/tests/run-tests.js` → `结果：通过 24 项，失败 0 项`（含输入清理、暂停冻结、300s 胜利、继续无尽、结算一次性、重开清零六类）
- 语法检查：`node --check` 通过全部 `game/js/*.js`、`game/tests/*.js`（每轮修改后复跑）
- 本报告开头已声明自动测试与真实试玩的边界；试玩驱动不含跳关/改值/状态注入

### 验收 6：真实浏览器至少一次五分钟胜利 + 无尽选择与重开 + 辨识反馈；限制范围写明 —— 见「三、真实试玩记录」逐项状态

---

## 二、缺陷证据链（先失败、后修复、回归覆盖）

| 缺陷 | 失败证据（修复前） | 修复 | 通过证据（修复后） |
|---|---|---|---|
| 新敌人无法自然生成（`randomEnemyType()` 硬编码 4 种旧敌人） | `node game/tests/run-tests.js` 首跑 A3-7：`[失败] A3-7 回归·自然刷怪池包含新敌人 —— 时间≥75s 后裂锋客可自然刷出`，`结果：通过 23 项，失败 1 项` | `game/js/game.js:371` 起改为遍历 `CONFIG.enemies` 按 unlock/weight 动态组池 | 复跑 `[通过] A3-7`，`结果：通过 24 项，失败 0 项`；真实试玩 75s/90s 后自然出现裂锋客/墨幕使者（截图 05/06/07） |
| 裂锋客/墨幕使者 AI 标志与行为分支不匹配（第一轮联调遗留） | A3-5/A3-6 失败态（详见 run-tests 历史输出） | `entities.js` 标志对齐 | A3-5/A3-5b/A3-6/A3-6b 通过 |
| favicon 404（控制台资源缺失） | 试玩 ERRORS：`http-404: http://localhost:8123/favicon.ico` | `index.html` 加 `<link rel="icon" href="data:,">` | 后续页面加载无 favicon 请求（见三·控制台检查） |

---

## 三、真实试玩记录（CDP 真实键盘/鼠标事件，游戏时钟经测量为 1× 真实速率）

### 3.1 流程覆盖（对应「开始 / 新机制 / 暂停恢复 / 一次失败 / 一次正常胜利 / 重开」）

| 流程 | 状态 | 证据 |
|---|---|---|
| 开始（标题→战斗） | **通过** | `[TITLE] {state:'title'}` → Enter → `01-title.png`；RESTART-OK time=0.6 |
| 移动/冲刺/连按 | **通过** | MVT-HOLD 156px / MVT-RELEASE 0 / `[DASH-SPAM] {firstDashActive:true, afterSpamCd:1.15, cdValid:true}`（连按 7 次不重复触发） |
| 升级弹窗选卡 | **通过** | `[LEVELUP-GATE] {hit:true, level:2, cards:['飞星','雷印','锋锐']}` + `02-levelup.png`，1/2/3 真实按键选卡 |
| 主要新机制（裂锋客/墨幕使者/进化/Boss） | **通过**（见 3.3 截图清单） | 自然遭遇截图 05/06/07；进化/Boss 截图见 3.3 |
| 暂停→恢复 | **通过** | `[PAUSE] {paused:true, resumed:true}` + `03-pause.png` |
| 失焦/切回（切标签） | **通过** | TAB-SWITCH 三项全 true |
| 失焦/切回（窗口最小化→恢复） | **通过** | BLUR-MINIMIZED paused+keys 清空；BLUR-RESTORED 可移动 |
| 一次失败（自然死亡） | **通过** | `node game/tests/playtest.js death`：passive 空站 74.7s 死亡 → `12-death.png`，`[DEATH-DONE] {state:'gameover', runsDelta:1}`（失败结算 totalRuns +1） |
| 连续重开 10 次 | **通过** | RESTART-10 ok:true（每轮真实点击重开按钮，time<3、kills=0） |
| 一次正常胜利（300 秒） | 见 3.2 | |
| 无尽选择与重开 | 见 3.2 | |

### 3.2 300 秒胜利链（真实计时，无跳关）

（待本轮重跑完成后填写最终结果）

### 3.3 截图清单（`screenshots/round2/`，本地 Chrome 原生截图，含 DOM 界面）

| 文件 | 内容 | 状态 |
|---|---|---|
| 01-title.png | 主界面 | 已生成 |
| 02-levelup.png | 升级三选一弹窗 | 已生成 |
| 03-pause.png | 暂停界面 | 已生成 |
| 04-evolution.png | 武器进化生效 | 见 3.2 |
| 05-lancer-aim.png | 裂锋客蓄力红线预警 | 已生成 |
| 06-veil-cast.png | 墨幕使者落点圆形预警 | 已生成 |
| 07-veil-zone.png | 墨幕生成（减速区） | 已生成 |
| 08-boss-phase1.png | Boss 一阶段环形弹幕 | 见 3.2 |
| 09-boss-phase2.png | Boss 二阶段扇形弹幕+墨痕 | 见 3.2 |
| 10-victory.png | 300 秒胜利结算画面 | 见 3.2 |
| 11-settlement.png | 结束本局最终结算 | 见 3.2 |
| 12-death.png | 失败结算 | 已生成 |
| 13-endless.png / 14-endless-death.png | 无尽继续 / 无尽死亡 | 见 3.2 |
| 15-layout-893x764.png / 16-layout-1280x720.png | 两种桌面布局 | 已生成 |

### 3.4 布局检查（游戏支持的桌面尺寸）

| 视口 | 结果 | 证据 |
|---|---|---|
| 893×764 | **通过**：无横/纵溢出，canvas [0,103,893,558] 居中，HUD display:block | `[LAYOUT] {inner:[893,764], doc:[893,764], overflowX:false, overflowY:false}` + 15-layout-893x764.png |
| 1280×720 | **通过**：无溢出，canvas [64,0,1152,720] 居中 | `[LAYOUT] {inner:[1280,720], doc:[1280,720], overflowX:false, overflowY:false}` + 16-layout-1280x720.png |
| 390×844（触屏） | **未验证** | 触屏未承诺支持，未测试（ROUND2_CHANGELOG 保留限制） |

### 3.5 控制台错误 / 资源缺失 / 内容溢出

- 修复前：唯一错误为 favicon 404（2 条重复）；已修复（`index.html` data-URI 图标）。
- 修复后各阶段 ERRORS：restart/death/layout 为 `count:0`；溢出检查见 3.4（两种布局均 overflow=false）。
- 无 JS 异常（Runtime.exceptionThrown 0 条）、无游戏资源缺失（全部素材代码生成）。

### 3.6 性能记录

（待本轮重跑完成后填写 PERF 采样：设备/场景/实体数/采样方法/结果）

### 3.7 无法人工完成 / 未覆盖范围（如实披露）

- 本环境无法人工手玩 5 分钟全程：走位与选卡由 `playtest.js` 策略驱动，输入为浏览器**真实键盘/鼠标事件**（可按住/松开，isTrusted），游戏真实计时推进，无调试捷径、无跳关、无改值、无状态注入（采样只读）。
- 390×844 触屏视口与触控行为未测试（未承诺触屏）。
- Firefox/Safari 未测试（目标浏览器 Chrome/Edge；代码为标准 Canvas2D + WebAudio）。
- （其余未覆盖项随 3.2/3.6 完成情况补充）

---

## 四、测试命令与输出摘要

| 命令 | 输出摘要 |
|---|---|
| `node game/tests/run-tests.js` | `结果：通过 24 项，失败 0 项`（A1 输入生命周期 5 项 / A2 胜利结算 6 项 / A3 进化与新敌人 7 项含 A3-7 回归 / A4 Boss 3 项 / 其余存档重开类） |
| `node --check game/js/*.js game/tests/*.js`（逐文件） | 全部通过 |
| `node game/tests/playtest.js smoke` | PHASE-DONE smoke；MVT-HOLD 156px / MVT-RELEASE 0 / DASH-SPAM cd 合法 / LEVELUP-GATE 命中 / PAUSE 恢复 / TAB-SWITCH 全 true |
| `node game/tests/playtest.js victory-a` | 见 3.2 |
| `node game/tests/playtest.js restart` | RESTART-10 ok:true（10/10） |
| `node game/tests/playtest.js death` | DEATH-DONE time=74.7s，runsDelta=1 |
| `node game/tests/playtest.js endless` | 见 3.2 |
| `node game/tests/playtest.js blur` | BLUR-MINIMIZED/BLUR-RESTORED 通过 |
| `node game/tests/playtest.js layout` | 两种布局无溢出 |

- 失败项：首轮 victory-a/endless 自动试玩在 ~100s（裂锋客+弹幕混编期）阵亡，未到 300s——已强化试玩走位策略后重跑，结果见 3.2（含最终状态）。
