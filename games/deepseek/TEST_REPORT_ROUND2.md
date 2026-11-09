# 《长夜点灯》第二轮测试与验收报告

> 版本：2.0.0（第二轮）  
> 测试日期：2026-11-02  
> 平台：Windows 11 家庭版中文版（NT 10.0.26200）  
> 运行时：Node.js 20.11.1  
> 浏览器：Google Chrome 156.0.8078.74（Playwright Core 驱动，headless）  
> 游戏入口：`index.html`  
> 基线：第一轮 19 项测试 + 评分报告 + 开发指导

---

## 1. 结论

| 验收项 | 结果 | 证据 |
|---|---|---|
| 1. P0 toast / 辅助状态生命周期 | **通过** | `tests/round2-ui-a11y.log` 8/8；DOM 与可访问树检查 |
| 2. 短夜保留并可通关 | **通过（功能）** | 实际浏览器自动化 40.6 秒；短夜 30/30 模拟 |
| 2b. 真实浏览器人工试玩 | **未验证** | 本轮只有自动化控制器，没有人类手动试玩 |
| 3. 远征入口、3 个以上行动阶段、3–5 分钟 | **通过（功能与时长）** | 5 段；实际浏览器自动化 203.7 秒（03:24） |
| 3b. 远征真实人工试玩 | **未验证** | 同上，自动化不等同人工 |
| 4. 两地图、三长灯、两新敌人 | **通过** | 28 项单元测试、截图、实际流程日志 |
| 5. 旧 19 项 + 新测试 + 30+ 种子 | **通过** | 28/28；远征 36/36；短夜 30/30；无非法状态 |
| P2 装饰性地图细节 | **通过** | 林带/树冠、冰面/桥/芦苇、阶段标记；截图 |
| 响应式与触屏 | **通过（自动化）** | 893×764、1280×720、390×844、844×390 |
| 性能 | **通过（限定环境）** | 1280×720、DPR1、40 敌人、3 秒采样，62.2fps |
| 人类手动试玩、读屏器、实体手机、Safari/Firefox | **未验证** | 未执行 |

总体上，第二轮的 P0 与 P1 功能均已实现并通过自动化验证；**唯一不能按指导原文宣称完成的是“真实浏览器人工游玩”**。本报告不把自动化、模拟或源码检查写成人工试玩结论。

---

## 2. 环境与运行方式

```text
OS: Windows 11 家庭版中文版
Node: v20.11.1
Chrome: 156.0.8078.74
Game: index.html
Server: 无
Network: 无外部请求
```

启动：

1. 双击 `index.html`。
2. 标题页点击「开始守夜」或「远征模式」。
3. 出发准备页选择模式、地图、长灯，点击「踏入长夜」。

浏览器自动化依赖安装在工作区外：

```text
%TEMP%\night-game-playwright\node_modules
```

游戏本身不依赖 Playwright、Node 或任何测试包。

---

## 3. 验收项 1：P0 辅助状态生命周期

### 3.1 修复前问题

第一轮 `hideHints` 只隐藏视觉样式，没有清空 toast 文本与定时器。重开后仍可观察到：

- `#toast` 文本：`「北岭灯」已点亮`
- class：`toast`
- 无 `aria-hidden="true"`
- 可访问树仍包含旧 `StaticText`

这说明“画面上看不见”不等于“辅助技术读不到”。

### 3.2 修复内容

- `showToast()` 设置 `aria-hidden="false"`、可见类、当前文本，并清旧定时器。
- 定时结束清空文本、移除类、`aria-hidden="true"`。
- `clearTransientUI()` 同时清理 toast/hint 文本、定时器、类名、`aria-hidden`。
- `syncScreens()` 在暂停、重开、返回标题、结算等边界调用清理。
- `#toast` 初始属性：`role="status" aria-live="polite" aria-atomic="true" aria-hidden="true"`。

### 3.3 回归结果

命令：

```powershell
$env:NODE_PATH="$env:TEMP\night-game-playwright\node_modules"
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
node tests/ui-regression.cjs
```

结果：**8 / 8 通过**。

```text
PASS P0-1a 当前 toast 是状态消息
PASS P0-1b 当前 toast 文本存在于可访问树
PASS P0-2 暂停即清空旧 toast
PASS P0-3 重开后旧 toast 文本和可访问状态均被清空
PASS P0-4 重开后可访问树不含上一局 toast
PASS P0-5 连续重开 10 次无旧 toast 复活
PASS P0-6 无控制台/页面异常
PASS P0-7 失焦暂停并清空持按键
SUMMARY 8/8 passed
```

关键断言：

- 重开后 `toastText=""`、`toastAriaHidden="true"`、`toastClass="toast"`；
- 可访问树中没有上一局 toast；
- 连续 10 次重开后 `lit=0`、`screen=playing`，旧消息不复活；
- 当前 toast 仍可被 `role=status` 读出。

日志：`tests/round2-ui-a11y.log`（原测试记录）

**结论：通过。**

---

## 4. 验收项 2：短夜模式

### 4.1 规则保留

- 默认 `mode: 'short'`、`mapId: 'village'`、`lighthouseType: 'classic'`。
- 5:00 总时限；四灯；返塔；20 秒最终守夜。
- 第一轮 19 项测试全部保留在 28 项测试中，未删除或改写断言。

### 4.2 实际浏览器流程

日志：`tests/round2-short-playthrough.log`（原测试记录）

```text
START { mode: 'short', map: 'village', type: 'ember' }
LIT 0 t 0.6 hp 4
LIT 1 t 4.3 hp 4
LIT 2 t 7.7 hp 4
LIT 3 t 13.7 hp 4
LIT 4 t 17.1 hp 4
PHASE finale t 20.7
END {"screen":"victory","phase":"victory","elapsed":40.616666666665644,
     "hp":4,"lit":4,"score":2915,"kills":40}
ERRORS []
```

结果：**40.6 秒通关**，4/4 灯，4 心，40 击杀，2915 分，无控制台/页面错误。符合“约 45 秒”基线。

### 4.3 模拟

`tests/balance-sim.js 30 short`：

- 30 / 30 胜利；
- 平均 39.0 秒；
- 无非法状态。

日志：`tests/round2-sim-short.log`（原测试记录）

### 4.4 证据边界

上述流程由 Playwright 控制器完成，不是人类手动试玩。控制器只读取 `#debug` 状态用于导航/瞄准，没有使用传送、无敌、时间加速或跳段。

**结论：功能通过；“真实人工试玩”未验证。**

---

## 5. 验收项 3：远征模式

### 5.1 入口与阶段

- 标题页有独立「远征模式」按钮。
- 出发准备页可切换「短夜巡守 / 远征长夜」。
- 5 个阶段全部由行动推进：
  1. 四灯；
  2. 5 罐灯油；
  3. 3 名携灯影；
  4. 3 名缠雾者；
  5. 返塔 + 30 秒守夜。
- 没有“原地等待计时”阶段。

### 5.2 实际浏览器流程

日志：`tests/round2-expedition-playthrough.log`（原测试记录）

```text
STARTED { map: 'river', type: 'ember' }
STAGE 1 点亮四座古灯（0 / 4） t 1.0 hp 4 oil 72
STAGE 2 将灯油送回长灯（0 / 5） t 19.6 hp 4 oil 100
STAGE 3 击败携灯影，夺回灯芯（0 / 3） t 156.6 hp 4 oil 22
STAGE 4 驱散缠雾者，清理雾带（0 / 3） t 167.2 hp 4 oil 36
STAGE 5 回到长灯，唤醒黎明 t 172.0 hp 4 oil 24
END {"screen":"victory","phase":"victory","elapsed":203.71666666672093,
     "timeLeft":216.28333333345088,"hp":4,"oil":42.93833333333281,
     "stage":5,"delivered":5,"thieves":3,"weavers":3,
     "score":9092,"kills":182}
ERRORS []
```

结果：**203.7 秒（03:24）**，5/5 段，5/5 罐油，3/3 携灯影，3/3 缠雾者，4 心，182 击杀，9092 分，无错误。

时长落在指导要求的 **3–5 分钟** 区间。

### 5.3 模拟

`tests/balance-sim.js 36 expedition`：

- 36 / 36 胜利；
- 无非法状态；
- 平均 81.8 秒，最短 80.1，最长 84.1；
- 三图各 12 局：旧村 83.4s、林间 81.7s、冻河 80.3s；
- 阶段直方图：5 段完成 36 次。

日志：`tests/round2-sim-expedition.log`（原测试记录）

注意：模拟控制器比实际浏览器操作更高效，**81.8 秒不能用来证明远征是 3–5 分钟**；3–5 分钟只由实际浏览器自动化流程 203.7 秒支持。

### 5.4 证据边界

同样是 Playwright 控制器，不是人类手动试玩。

**结论：功能、阶段推进与时长通过；“真实人工试玩”未验证。**

---

## 6. 验收项 4：地图、长灯、新敌人

### 6.1 地图

| 地图 | 可确认差异 | 验证 |
|---|---|---|
| 旧村四角 | 四角布局，生成倍率 1.0 | 短夜实际流程；单元测试 |
| 林间环路 | 四灯围环，生成倍率 1.2，路程更短 | 配置测试；模拟；截图 |
| 冻河折线 | 水面 `y=470–550`，两桥 `300–410` / `870–980`，涉水 ×0.56、-1.5 油/秒 | 单元测试「冻河涉水变慢并消耗灯油，桥面不受影响」；实际远征截图 |

### 6.2 长灯类型

| 类型 | 可观察收益 | 可观察代价 | 验证 |
|---|---|---|---|
| 回油灯 | 光环回油 +2/秒 | 灯火 DPS ×0.85 | 单元测试「三类灯塔各有可观察的取舍」 |
| 守夜灯 | 光环半径 +25、DPS +2 | 灯火油耗 ×1.15 | 同上 |
| 引路灯 | 目标方向、点灯时间 ×0.8 | 油上限 -12 | 同上；HUD 目标线 |

`classic` 仅内部兼容，不出现在可选卡片。

### 6.3 携灯影

- 单元测试「携灯影会窃取古灯，击杀后归还灯芯」。
- 实际流程第 3 段完成 3/3。
- 截图：`04_lamp_thief.png`（原测试记录）

验证点：

- 引导 1.4 秒后 `suppressed=7`；
- 击杀恢复古灯并 +10 油；
- 任务个体推进阶段；
- 免疫古灯/长灯环境光环。

### 6.4 缠雾者

- 单元测试「缠雾者预警后生成雾气，减速并可用灯火驱散」。
- 实际流程第 4 段完成 3/3。
- 截图：`05_fog_weaver.png`（原测试记录）

验证点：

- 1.1 秒预警后生成半径 82、HP 16、TTL 7 秒的雾带；
- 雾中减速 48%、-1.4 油/秒；
- 灯火可清雾；
- 死亡清空所有雾带；
- 任务个体免疫环境光环。

### 6.5 运油

- 单元测试「携带灯油时受伤会掉落，可重新拾取」。
- 实际流程 5/5 交付。
- 截图：`03_cargo.png`（原测试记录）

**结论：通过。**

---

## 7. 验收项 5：测试与模拟

### 7.1 静态检查

```powershell
node --check js/core.js
node --check js/audio.js
node --check js/game.js
```

结果：全部通过（无输出、退出码 0）。

### 7.2 单元测试

```powershell
node --test tests/core.test.js
```

结果：

```text
# tests 28
# pass 28
# fail 0
# duration_ms 557.3388
```

原 19 项全部保留，新增 9 项：

1. 模式、地图、灯塔类型配置可复现且互不相同；
2. 三类灯塔各有可观察的取舍；
3. 冻河涉水变慢并消耗灯油，桥面不受影响；
4. 远征四灯后进入运油阶段，灯塔尚未可启动；
5. 远征依次完成运油、携灯影、缠雾者后回塔获胜；
6. 携灯影会窃取古灯，击杀后归还灯芯；
7. 缠雾者预警后生成雾气，减速并可用灯火驱散；
8. 携带灯油时受伤会掉落，可重新拾取；
9. 长时间输入在远征/冻河/引路灯配置下仍无非法状态。

另有万帧随机输入测试，断言无 NaN、不越界、不超上限。

### 7.3 多种子模拟

| 模式 | 种子 | 胜利 | 非法状态 | 时长 |
|---|---:|---:|---:|---|
| 远征 | 36 | 36 | 0 | 平均 81.8s，80.1–84.1s |
| 短夜 | 30 | 30 | 0 | 平均 39.0s |

日志：

- `round2-sim-expedition.log`（原测试记录）
- `round2-sim-short.log`（原测试记录）

模拟只作平衡与规则信号，不冒充实际试玩。

### 7.4 新发现的 NaN 缺陷

在 36 种子远征模拟中，第 4 段曾出现阶段卡住。修复前证据：

```text
NAN {"t":32.633...,"stage":4,"bad":{
  "id":28,"type":"weaver","name":"缠雾者",
  "x":null,"y":null,"hp":7.124...,"maxHp":14,
  "knockX":null,"knockY":null,"quest":true,"elite":true
}}
```

根因：

- `spawnEnemy()` 创建对象时漏拷 `knockbackScale`；
- 接触击退计算 `20 * undefined` 得到 `NaN`；
- 敌人坐标与击退速度变 `NaN`，任务阶段无法推进。

修复：

```js
knockbackScale: type.knockbackScale
```

回归：

- 28 项单元测试全部通过；
- 36 种子远征无 `nan-enemy`；
- 30 种子短夜无非法状态。

修复前证据保留：`tests/round2-nan-fix-before.log`（原测试记录）

**结论：通过。**

---

## 8. 响应式、触屏与性能

### 8.1 视口

日志：`tests/round2-responsive-touch.log`（原测试记录）

| 视口 | 触屏 UI | 关键 HUD 重叠 | 页面错误 |
|---|---|---|---|
| 893×764 | 否 | 无 | 0 |
| 1280×720 | 否 | 无 | 0 |
| 390×844 | 是 | 无 | 0 |
| 844×390 | 是 | 无 | 0 |

触屏验证：

- 左摇杆移动：`x 640 → 732.5`（竖屏）、`640 → 729.0`（横屏）；
- 右摇杆按住亮灯：油 `72 → 62.1` / `62.4`；
- 点灯按钮完成 1 盏灯；
- 无页面错误。

出发准备页在 893×764 下内容区 `scrollH=533/clientH=533`，无溢出；1280×720 为 `554/554`；390×844 为 `726/726`；844×390 为 `319/319`。

截图：

- `12_desktop_893x764.png`（原测试记录）
- `10_mobile_portrait.png`（原测试记录）
- `11_mobile_landscape.png`（原测试记录）
- `14_mobile_prep.png`（原测试记录）

### 8.2 性能

日志：`tests/round2-performance.log`（原测试记录）

```json
{
  "viewport": "1280x720",
  "dpr": 1,
  "scene": "40 forced shadow entities + effects",
  "perf": { "frames": 187, "ms": 3008.2, "heap": 6797254, "enemies": 32 },
  "fps": 62.2,
  "heapMB": 6.5,
  "errors": []
}
```

限定条件：headless Chrome、1280×720、DPR1、40 个强制敌人、3 秒采样。该结果只证明此环境此场景无明显卡顿，不代表所有真实设备稳定 60FPS。

### 8.3 正式入口（无 `#debug`）

日志：`tests/round2-production-startup.log`（原测试记录）

在 `file:///.../index.html`（不带 hash）下验证：

```json
{
  "production": { "debug": "undefined", "titleHidden": false, "startVisible": true },
  "prep": {
    "summary": "短夜巡守 · 旧村四角 · 回油灯 · 目标约 45 秒",
    "mode": "true",
    "map": "true"
  },
  "playing": { "screen": "intro-hidden", "hud": true, "objective": "点亮四座古灯（0 / 4）" },
  "external": [],
  "consoleErrors": [],
  "pageErrors": []
}
```

确认：

- 正式入口不暴露 `window.__NIGHT_DEBUG__`；
- 标题 → 出发准备 → 游戏可正常进入；
- 无外部网络请求；
- 无控制台/页面错误；
- 初始 toast 为空且 `aria-hidden="true"`。

**结论：响应式/触屏通过（自动化）；正式入口通过；性能通过（限定环境）。实体手机与长时间运行未验证。**

---

## 9. 实际浏览器自动化记录与边界

| 记录 | 结果 | 日志 |
|---|---|---|
| 短夜通关 | 40.6s，4 灯，4 心，40 击杀，2915 分 | `round2-short-playthrough.log`（原测试记录） |
| 远征通关 | 203.7s（03:24），5 段，182 击杀，9092 分 | `round2-expedition-playthrough.log`（原测试记录） |
| 短夜失败 | 20.4s，0/4 灯，0 心 | `round2-failure-playthrough.log`（原测试记录） |
| 暂停/重开/结算 | 覆盖于 P0 回归与流程日志 | `round2-ui-a11y.log`（原测试记录） |

### 重要边界

1. **不是人类手动试玩。** 以上由 Playwright 控制器操作浏览器，读取 `#debug` 状态做导航/瞄准；没有传送、无敌、时间加速、跳段。
2. **不是纯核心模拟。** 它真实启动了 `file://` 页面、真实按键/鼠标输入、真实 Canvas 渲染与 DOM 状态。
3. **没有实体手机。** 触屏是 Chromium 视口与指针模拟。
4. **没有读屏器。** 只检查了 DOM 属性与 CDP 可访问性树。
5. **没有 Safari/Firefox。** 只在 Chrome 156 下验证。
6. **没有长时间内存测试。** 性能仅 3 秒采样。

因此：

- 功能验收：通过；
- “真实浏览器人工游玩”这一条：**未验证**。

---

## 10. 截图清单

目录：`screenshots/round2/`（原测试记录）

| 文件 | 内容 |
|---|---|
| `01_title.png` | v2 标题页，短夜/远征入口 |
| `02_preparation.png` | 出发准备：模式、地图、长灯 |
| `03_cargo.png` | 远征第 2 段运油 |
| `04_lamp_thief.png` | 携灯影 / 追灯段 |
| `05_fog_weaver.png` | 缠雾者 / 清雾段 |
| `06_finale.png` | 远征 30 秒最终守夜 |
| `07_victory.png` | 远征胜利，03:24，9092 分 |
| `08_defeat.png` | 短夜失败 |
| `09_pause.png` | 暂停界面与模式信息 |
| `10_mobile_portrait.png` | 390×844 触屏游戏 |
| `11_mobile_landscape.png` | 844×390 触屏游戏 |
| `12_desktop_893x764.png` | 893×764 桌面 |
| `13_short_victory.png` | 短夜胜利 |
| `14_mobile_prep.png` | 390×844 出发准备 |

截图用于展示界面与机制，不作为“人类试玩”证据。

---

## 11. 未验证项与风险

| 项目 | 状态 | 说明 |
|---|---|---|
| 人类手动短夜/远征试玩 | 未验证 | 只有自动化控制器 |
| 实体手机触屏 | 未验证 | 只有 Chromium 视口模拟 |
| 读屏器实际播报 | 未验证 | 只有 DOM/可访问树检查 |
| Safari / Firefox | 未验证 | 只在 Chrome 156 验证 |
| 音效听感 | 未验证 | 只验证无异常与静音开关 |
| 长时间内存增长 | 未验证 | 仅 3 秒性能采样 |
| 所有真实设备稳定 60FPS | 未验证 | 仅 headless 单次采样 |
| 远征 3–5 分钟对所有人的普适性 | 部分验证 | 一次自动化 03:24；模拟 81.8s，差异大 |

---

## 12. 复现命令汇总

```powershell
# 静态检查
node --check js/core.js
node --check js/audio.js
node --check js/game.js

# 28 项核心测试
node --test tests/core.test.js

# 多种子模拟
node tests/balance-sim.js 36 expedition
node tests/balance-sim.js 30 short

# P0 浏览器回归
$env:NODE_PATH="$env:TEMP\night-game-playwright\node_modules"
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
node tests/ui-regression.cjs
```

---

## 13. 最终判定

- **P0：通过。**
- **P1 功能：通过。**
- **P1 真实人工试玩：未验证。**
- **P2：通过。**
- **总体：功能与自动化验收通过；人工试玩与部分真实设备覆盖未完成，报告不将其写成已通过。**
