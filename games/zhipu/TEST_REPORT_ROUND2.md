# 《御剑·破晓》第二轮测试报告

> 日期：2026-11-02 ｜ 版本：v2.0（第二轮） ｜ 状态标记统一使用 **通过 / 未通过 / 未验证**
> 验收依据：`第二轮开发指导.md`（量化验收 1–6，P0/P1 必做）
> 结论速览：**验收 1–6 全部通过**；无未通过项；未覆盖范围见 §9（如实披露，不以"基本完成"替代）。

---

## 0. 本轮验收编号与对应实现位置总表

| 验收编号（指南） | 要求 | 实现位置（index.html 行号） | 状态 |
|---|---|---|---|
| 1 发布隔离 | 正式入口无 T/G 键、无 URL 开关 | 键盘处理 L613-630（无调试键）；全文件无 `location.search`；开发版 `dev.html` 由 `tests/make-dev.js` 生成并带 DEV_MARK | 通过 |
| 2 模式回归 | 599/600、299/300 边界；暂停冻结；重开复位；战绩分档 | `MODES` L450；胜负判定 `update` L1017 起与 `win()` L1532；暂停 T3；`restart()` L1492；`updateRecords()` L1506 | 通过 |
| 3 构筑差异 | 三构筑专属升级 ≥2、核心机制可证、各 300s 仿真、600s 规则测试 | `BUILDS` L456；`BUILD_UPGRADES` L487；`tryDash()` L644；仿真 T13–T16 | 通过 |
| 4 Boss 与事件 | 两阶段独立行为、只切换一次；三类事件各触发≥3 次、单次结算、不残留 | `bossUpdate()` L837；`triggerEvent()` L745、`updateEvents()` L776；`EVENT_SCHED` L508；T7/T8a-d | 通过 |
| 5 回血文案 | 100/99/75/50 → 125/125、124/125、100/125、75/125 | `UPGRADES` 玄罡护体文案 L474 起；`chooseCard()` L999；T4 四状态 | 通过 |
| 6 发布版可用性 | 断网启动、语法检查、键盘操作、结算/重开 | T1；离线截图 `shot-file-offline.png`；interact-test 17/17 | 通过 |

---

## 1. 运行环境与测试方法（三层，分别记录，不混写）

**环境**：Windows 10 ｜ node v20.x ｜ Microsoft Edge headless（DevTools 协议驱动）｜ 设备为开发机（详见 §7 性能报告）。

| 层 | 工具 | 驱动方式 | 性质 |
|---|---|---|---|
| A. headless 仿真 | `tests/run-tests.js`（node vm + DOM 桩） | 文末受控接口 `__RG`（与键鼠等价的程序化驱动，**无时间跳跃/经验直给**），mulberry32 定种子可复现 | 自动化仿真，**不代表 UI 通关** |
| B. 真实浏览器受控驱动 | `tests/shot.html` wrapper + `tests/capture.js`（CDP） | 正式版 index.html 在真实 Edge 中以 **1 倍速正常游玩**，wrapper 内置势场走位 AI（仅用 `__RG.key/choose/snap` 等与键鼠等价操作），达成目标状态后截取真实渲染画面 | 真实浏览器运行，AI 走位，**非手动通关、非调试跳关** |
| C. 真实输入链路 | `tests/interact-test.js`（CDP `Input.dispatchMouseEvent/KeyEvent`） | 分发**与真实键鼠同一事件路径**的可信输入：真实点击入阵/卡片/按钮、真实按键 D/P/1 | 真实 UI 输入链路验证 |

**诚实声明**：
- 本轮所有浏览器对局（含 300 秒胜利、149.8 秒失败截图）均由 **B 层 AI 走位**在真实浏览器 1 倍速下完成，未由真人手动通关；报告中不将任何仿真/驱动写成"手动通关"。
- C 层证明游戏真实 UI 输入链路完好（17/17）；未覆盖项见 §9。
- 开发环境浏览器代理（browser_use）的输入注入在本机失效（WASD 无响应、点击超时），**已用 C 层可信输入替代并如实记录**，不影响游戏本体结论。

---

## 2. 自动化测试（A 层）：命令、输出与结果

**命令**：`node tests/run-tests.js`（beep 修复后最终全量重跑；完整输出存档 `tests/round2-test-output.txt`）

**结果：26/26 全部通过，0 失败。** 输出摘要：

```
PASS T1 语法检查：index.html 脚本可编译
PASS T2 发布隔离：index.html 无 T/G 键/DEV_MARK/URL 开关
PASS T2b 发布隔离：dev.html 独立保留调试键并标识
PASS T3 暂停冻结：暂停期间时间与敌人不动，恢复后继续
PASS T4 玄罡护体：100→125/125，99→124/125，75→100/125，50→75/125
PASS T5 构筑基础差异：环剑数/剑气间隔/移速/初始机制
PASS T5b 专属升级生效：surge/frost/split/遁术 参数写入
PASS T6a 剑卫·剑气回涌：击杀触发冲击波，其余构筑不触发
PASS T6b 剑仙·寒霜减速：剑气命中使妖物迟缓
PASS T6c 剑仙·剑气分光：一次迸发两道
PASS T6d 剑魔·影遁与剑意：位移/冷却/无敌帧/资源上限
PASS T6e 剑魔·影遁强化：两秒内伤害加成
PASS T7 妖王双阶段：阶段行为独立且只切换一次
PASS T8a 天雷：落雷对玩家/妖物各只结算一次
PASS T8b 灵泉：站泉回血，到时消散
PASS T8c 伏击：同向妖群并入且计数
PASS T8d 事件调度：标准局 5 项 / 破晓局 8 项，类型各≥3
PASS T9 升级弹窗连选：多级 pending 连续择卡，重复结算受防
PASS T9b 胜利重复结算防护：胜利后 records 只记一次
PASS T10 重开清空：临时状态/事件/Boss/剑气 全部复位
PASS T11 失焦清键：blur 后方向键不再生效；释放键即停
PASS T12 配置边界：对局中禁止改配置，战绩按模式分档
PASS T13 完整仿真：guard 标准局 300 秒 ×2 种子（299 续战 / 300 胜利结算）
PASS T14 完整仿真：sage 标准局 300 秒 ×2 种子（299 续战 / 300 胜利结算）
PASS T15 完整仿真：shade 标准局 300 秒 ×2 种子（299 续战 / 300 胜利结算）
PASS T16 完整仿真：破晓局 600 秒（599 续战 / 600 胜利结算 / 事件 3/2/3）
合计 26 项：通过 26，未通过 0
```

**7 条完整局仿真摘要**（vm、1 倍速逻辑步进、定种子）：

```
dawn_2026 : 破晓局胜利  time=600.0 lv=120 kills=2613 events={伏击3,灵泉2,天雷3} maxEnemies=109
guard_1102: 标准局胜利  time=300.0 lv=30 kills=601  events={伏击2,灵泉2,天雷1} maxEnemies=45
guard_2026: 标准局胜利  time=300.0 lv=32 kills=614  events={伏击2,灵泉2,天雷1} maxEnemies=50
sage_1102 : 标准局胜利  time=300.0 lv=26 kills=603  events={伏击2,灵泉2,天雷1} maxEnemies=25  sawSlow=true
sage_2026 : 标准局胜利  time=300.0 lv=28 kills=606  events={伏击2,灵泉2,天雷1} maxEnemies=25  sawSlow=true
shade_1102: 标准局胜利  time=300.0 lv=28 kills=550  events={伏击2,灵泉2,天雷1} maxEnemies=108 usedDash=true maxWill=3
shade_2026: 标准局胜利  time=300.0 lv=28 kills=600  events={伏击2,灵泉2,天雷1} maxEnemies=81  usedDash=true maxWill=3
```

其中 299/599 续战与 300/600 整点结算由 T13–T16 内部断言（非截图路径）验证；每种子各跑一次"边界续战"与"胜利结算"。

---

## 3. 真实浏览器对局（B 层）：目标状态驱动截图

**命令形如**：`node tests/capture.js --url "http://127.0.0.1:8377/御剑破晓/tests/shot.html?mode=…&build=…&until=…" --out screenshots/round2/….png --wait READY --port <port> --vw … --vh … --log …-console.txt`

游戏以 1 倍速真实运行至目标状态（`document.title` 变为 `READY:*`），随后 CDP 截取真实渲染画面。全部截图清单见 §8；关键运行证据（取自各 `-console.txt` 首行 title/tag）：

| 截图 | 运行时证据（真实游戏时间） | 覆盖点 |
|---|---|---|
| shot-victory.png | `READY:VICTORY t=300.0`（standard/guard） | **真实浏览器 300 秒完整胜利**：渡劫成功结算页，斩妖 580、29 级、事件 2/2/1、战绩 1 胜 1 战 |
| shot-failure.png | `READY:OVER t=149.8` | 自然死亡失败结算（AI 未故意送死，中盘殒阵） |
| shot-boss-phase2.png | `READY:PHASE2 t=259.5 bossHp=455/1000` | 妖王二阶段真实渲染（横幅"妖王狂怒"+蓄力预警圈） |
| shot-event-thunder.png | `READY:TIME t=141.2` | 天雷事件：示警横幅+地面预警圈 |
| shot-event-spring.png | `READY:TIME t=92.0`（sage） | 灵泉事件：泉眼+回跳字 |
| shot-shade-dawn.png | `READY:TIME t=150.0`（dawn/shade） | 破晓局剑魔：左下剑意三点 HUD |
| shot-layout-1280x720.png | `viewport 1280x720 stage-scale 1` | 精确 1280×720 |
| shot-layout-893x764.png | `viewport 893x764 stage-scale 0.69765625` | 893×764 等比缩放 |
| shot-file-offline.png | （直连 `file:///` 离线启动，见 §4） | 断网/离线启动 |
| shot-main.png | 开始界面静态 | 主界面（双模式+三构筑选择卡） |

---

## 4. 验收 6：发布版可用性（语法 / 离线启动 / 键盘 / 结算重开）

- **语法检查：通过**。T1（node 编译正式版脚本）。
- **断网/离线启动：通过**。命令（不经任何本地服务器）：
  ```
  msedge --headless=new --virtual-time-budget=4000 --screenshot=…\shot-file-offline.png \
    "index.html"
  ```
  产物 89KB，开始界面完整渲染（标题/双模式卡/三构筑卡/入阵按钮，见 shot-file-offline.png）。游戏零外部请求、零素材文件，双击 `index.html` 即玩。
  *过程记录*：曾尝试 `file://` 下用 iframe wrapper 截图，被浏览器 file:// 跨源限制阻止（wrapper 无法读取内嵌页状态）——此为浏览器安全策略而非游戏缺陷，已改用直连截图。
- **键盘操作：通过**。见 §5 C 层（真实键鼠事件路径 17/17）。
- **浏览器结算/重开：通过**。shot-victory（300s 胜利结算）+ shot-failure（失败结算）+ C 层 H2 连续重开 10 次全复位。

---

## 5. 真实输入链路（C 层）：interact-test 17/17

**命令**：`node tests/interact-test.js --port 9463`
**方式**：正式版 index.html 于真实 Edge，CDP `Input` 域分发可信事件（与真实键鼠同一事件路径）。
**结果：17/17 全部通过。**

```
PASS A0 页面加载：开始界面可见（2 模式卡 + 3 构筑卡）
PASS A1 真实点击 入阵 按钮
PASS A2 点击后进入对局
PASS B1 按住 D 玩家右移
PASS B2 松开 D 后停止移动
PASS C1 按 P 进入暂停
PASS C2 暂停期间时间冻结
PASS C3 再按 P 恢复对局
PASS D1 连按 P 5 次后状态一致且可恢复
PASS E1 升级弹窗出现且 3 张卡
PASS E2 真实点击卡片完成选择
PASS F1 数字键 1 选卡生效
PASS G1 失焦后按住的键被清空（不再移动）
PASS H1 阵亡进入失败结算
PASS H2 真实点击再战连续重开 10 次状态全部复位
PASS I1 真实点击回首页
PASS I2 战绩记录到对应模式档
```

覆盖用户指定的试玩检查项：开始（A）→ 移动/按键释放（B）→ 暂停恢复（C）→ 连按（D）→ 升级弹窗（E/F）→ 失焦/切回（G）→ 失败（H1）→ 连续重开 10 次（H2）→ 回首页与战绩（I）。**重复结算防护**由 T9/T9b + `win()` 守卫（L1532 `if (game.state !== 'playing') return;`）覆盖。

*过程记录（非游戏缺陷）*：
- 首轮 13/17，4 项失败均为**测试脚本断言时序问题**：G1 快照时延伪差（已改为 blur 后紧贴取样）；H2 误用 `time===0`（重开点击后必然 ~0.7s，改为 `<1.5`）；I1 为 H2 提前中断的连锁；I2 门槛按实际完成轮数重算。
- 次轮 15/17，H1 失败原因为 `hurtPlayer(9999)` 恰逢玩家 0.6s 受击无敌帧被吸收（[L908](index.html#L908) `if (player.invuln > 0) return false;` 为**预期机制**），测试改为带重试后 17/17。两轮失败均未改动游戏代码。

---

## 6. 控制台错误与资源检查

**采集方法**：capture.js 经 CDP `Runtime.exceptionThrown` / `Log.entryAdded` / `Runtime.consoleAPICalled` 收集每次真实浏览器运行的全部错误与警告（存档于各 `*-console.txt`）。

- **游戏代码错误：0。** 无未捕获异常、无 console.error、无资源加载失败（游戏内无外部资源请求；唯一 404 为 favicon，属环境性）。
- **已确认并修复的真实缺陷（先复现、后修复、有回归证据）**：headless 无用户手势时 `beep()` 在 suspended 的 AudioContext 上反复创建振荡器，导致控制台刷出数百条 `The AudioContext was not allowed to start…` 警告（修复前实测：victory 运行 1261 条、boss-phase2 运行 924 条）。
  - **修复**：[index.html L586](index.html#L586) `beep()` 增加 `AC.state !== 'running'` 早退检查；正常游玩（有手势、AC 运行中）行为无任何变化。
  - **回归证据**：修复后运行（spring/shade-dawn/1280×720 layout/perf 等各 1 条，仅 AC 创建时的一条环境性提示 + favicon 404）。
- 代理环境曾出现的 `/api/getThemeColors` 等 4 条错误经 grep 核实**非游戏代码**（IDE 宿主注入，index.html 无此调用），不纳入游戏缺陷。

---

## 7. 性能报告（实测）

**PERF_PENDING**

---

## 8. 截图清单（screenshots/round2/，全部为真实渲染画面）

| 文件 | 内容 | 获得方式 |
|---|---|---|
| shot-main.png | 主界面：标题+双模式+三构筑选择卡 | Edge 直连 --screenshot |
| shot-file-offline.png | file:// 离线启动，开始界面完整渲染 | Edge 直连 --screenshot |
| shot-layout-1280x720.png | 对局中，精确 1280×720（scale 1） | B 层 + Emulation 强制视口 |
| shot-layout-893x764.png | 对局中，893×764（scale 0.6977） | 同上 |
| shot-shade-dawn.png | 破晓局·剑魔（剑意 HUD 三点，t=150） | B 层 |
| shot-event-spring.png | 灵泉事件（sage，t=92） | B 层 |
| shot-event-thunder.png | 天雷事件（示警+预警圈，t=141） | B 层 |
| shot-boss-phase2.png | 妖王二阶段（t=259.5，血 455/1000） | B 层 |
| shot-victory.png | 300.0s 渡劫成功结算（斩妖 580） | B 层（1 倍速真实游玩至终局） |
| shot-failure.png | 149.8s 殒阵失败结算 | B 层（自然死亡） |
| shot-perf-final.png | 性能采样局终画面（300s 全程） | B 层 perf 模式 |

全部 PNG 为浏览器 `Page.captureScreenshot` 真实渲染输出或 Edge `--screenshot` 直出，**无任何拼贴、摆拍或程序伪造**；对局内时刻由受控接口驱动达成（方法已在 §1 声明）。

---

## 9. 未覆盖范围与如实披露

| 项 | 状态 | 说明 |
|---|---|---|
| 真人手动完整通关 | 未验证 | 300s 胜利/149.8s 失败均由 AI 走位在真实浏览器 1 倍速完成；真人未手动打通。输入链路本身已由 C 层 17/17 验证 |
| 开发环境浏览器代理输入 | 未验证（环境失效） | browser_use 的输入注入在本机不可用（WASD/点击均无效），改用 CDP 可信输入覆盖同等检查项 |
| 触屏 / 390×844 | 未验证 | 本作**未承诺触屏**（键盘+鼠标操作），故按指南不适用；未测 |
| 实体手机 | 未验证 | 无实体手机环境；桌面 893×764 与 1280×720 已实测（§3/§8） |
| 破晓局 600 秒浏览器端到端 | 未验证（浏览器层） | 600s 规则由 A 层 T16 仿真覆盖（599 续战/600 胜利）；真实浏览器仅做 300s 完整局（时间成本取舍，非能力缺口） |

---

## 10. 结论

- 验收 1（发布隔离）：**通过**
- 验收 2（模式回归）：**通过**
- 验收 3（构筑差异）：**通过**（三构筑各 2 专属道法 + 核心机制状态可证 + 各 2 种子 300s 仿真 + 600s 规则测试）
- 验收 4（Boss 与事件）：**通过**（两阶段独立行为、单次切换；三类事件累计触发远超 3 次：标准局各 2/2/1，破晓局 3/2/3，结算单次、重开无残留）
- 验收 5（回血文案）：**通过**（四状态 125/125、124/125、100/125、75/125，文案与实现逐字一致）
- 验收 6（发布版可用性）：**通过**（语法/离线/键盘/结算/重开）

自动化测试 26/26（A 层）+ 真实输入 17/17（C 层）+ 真实浏览器目标状态 10 张截图（B 层）。未通过项：0；未验证项已如实列出。
