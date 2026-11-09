# 《长夜点灯》开发文档

> 版本：2.0（第二轮）  
> 技术栈：原生 HTML / CSS / JavaScript（ES2018）+ Canvas 2D + WebAudio  
> 构建：无。双击 `index.html` 即可运行。  
> 目标浏览器：Chrome / Edge / Firefox / Safari 近两年版本  
> 验证环境：Windows 11 · Node.js 20.11.1 · Chrome 156（headless/headed 自动化）

---

## 1. 工程目标

1. **离线可玩**：不依赖 CDN、图片、字体或后端。
2. **逻辑可测**：核心规则与 DOM/Canvas 解耦，可在 Node 中直接运行单元测试。
3. **两种模式共用一套规则核心**：短夜与远征通过配置和阶段数据分流，不复制玩法代码。
4. **两种输入同等完整**：键鼠与触屏都能完成整局。
5. **辅助状态可清理**：`role=status` / `aria-live` 的提示在暂停、切换、重开、结算边界不残留上一局内容。
6. **整个文件夹直接分发即可游玩**：运行所需文件为 `index.html` + `styles.css` + `js/*.js`。

---

## 2. 目录结构

```
deepseek小游戏/
├─ index.html
├─ styles.css
├─ js/
│  ├─ core.js          # 纯规则模拟（无 DOM / 无 Canvas / 可 Node 测试）
│  ├─ audio.js         # WebAudio 程序化音效与环境声
│  └─ game.js          # 状态机、输入、渲染、UI、存档、主循环
├─ docs/
│  ├─ GAME_DESIGN.md
│  ├─ DEVELOPMENT.md
│  └─ TEST_REPORT.md   # 第一轮报告（历史）
├─ tests/
│  ├─ core.test.js     # 28 项 Node 原生 test runner 单元测试
│  ├─ balance-sim.js   # 短夜/远征多种子模拟（开发辅助）
│  ├─ ui-regression.cjs# P0 + 辅助状态浏览器回归（开发辅助）
│  └─ round2-*.log     # 第二轮证据日志
├─ screenshots/
│  ├─ round2/          # 第二轮验收截图
│  └─ ...              # 第一轮截图
├─ ROUND2_CHANGELOG.md
├─ TEST_REPORT_ROUND2.md
└─ README.md
```

`node_modules` 不属于交付物；浏览器自动化依赖安装在工作区外的临时目录（`%TEMP%\night-game-playwright`）。

---

## 3. 总体架构

```
                    ┌────────────────────┐
  键盘 / 鼠标 / 触屏 →│      game.js       │→ DOM HUD / 覆盖层
                    │ 输入适配 + 渲染循环 │
                    └─────────┬──────────┘
                              │ input (归一化)
                    ┌─────────▼──────────┐
                    │      core.js       │
                    │ 固定步长规则模拟    │
                    │ 玩家/敌人/灯光/计时 │
                    └─────────┬──────────┘
                              │ events
                    ┌─────────▼──────────┐
                    │  game.js 消费事件   │
                    │ 音效/粒子/震屏/UI   │
                    └────────────────────┘
```

### 分层原则

- `core.js` 不知道像素、颜色、按钮、音频；不访问 `window`、`document`、`localStorage`。
- `core.js` 只接收归一化输入，推进固定时间步，产生事件。
- `game.js` 将鼠标/触屏/键盘转换为同一份输入；消费事件做表现与音效。
- `audio.js` 只暴露 `init / setMuted / setFocus / sfx.* / suspend / resume`。
- 所有新机制（模式、地图、长灯、远征阶段、携灯影、缠雾者、雾带）的规则都在 `core.js`。

---

## 4. 核心模块 API

### 4.1 UMD 导出

`core.js` 同时支持浏览器全局与 Node：

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NightCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ...
  return {
    VERSION, BALANCE, MAPS, MODES, LIGHTHOUSE_TYPES, ENEMY_TYPES,
    createGame, update,
    getObjective, getObjectiveTargets, getInteractTarget, getNearestBrazier,
    getLighthouseDistance, isInteractable,
    getMapConfig, getModeConfig, getLighthouseConfig,
    getBeamDps, getBeamOilPerSec, getBrazierAuraRadius,
    getBrazierAuraDps, getBrazierAuraRegen, getIgniteTime,
    isInFog
  };
});
```

`VERSION = '2.0.0'`。

### 4.2 平衡常量

关键值（完整表见 `js/core.js` 顶部 `BALANCE`）：

```js
BALANCE = {
  WORLD_W: 1280, WORLD_H: 720,
  PLAYER_SPEED: 198, PLAYER_RADIUS: 15, PLAYER_MAX_HP: 4,
  OIL_MAX: 100, OIL_START: 72,
  BASE_LIGHT_RADIUS: 92, BASE_LIGHT_DPS: 2,
  BEAM_RANGE: 330, BEAM_HALF_ANGLE: 21 * Math.PI / 180,
  BEAM_DPS: 21, BEAM_OIL_PER_SEC: 18, BEAM_SLOW: 0.35,
  FOCUS_SPEED_MULT: 0.85,
  DASH_SPEED: 737.5, DASH_TIME: 0.16,
  DASH_COOLDOWN: 2.5, DASH_IFRAME: 0.18, HIT_IFRAME: 1.1,
  BRAZIER_INTERACT_RADIUS: 82, BRAZIER_IGNITE_TIME: 1.8,
  BRAZIER_IGNITE_COST: 15, BRAZIER_RESTORE_OIL: 30,
  BRAZIER_AURA_RADIUS: 110, BRAZIER_AURA_DPS: 5,
  BRAZIER_AURA_SLOW: 0.30, BRAZIER_AURA_REGEN: 3,
  LIGHTHOUSE_INTERACT_RADIUS: 105, LIGHTHOUSE_START_TIME: 0.8,
  NIGHT_DURATION: 300, FINALE_DURATION: 20,
  FINALE_DURATION_EXPEDITION: 30, FINALE_MIN_TIME: 45,
  FINALE_AURA_START: 120, FINALE_AURA_END: 210,
  FINALE_AURA_DPS: 6, FINALE_AURA_SLOW: 0.25, FINALE_AURA_REGEN: 3,
  FINALE_SPAWN_INTERVAL: 0.58,
  MAX_ENEMIES: 46, MAX_PICKUPS: 10, PICKUP_TTL: 20,
  PICKUP_OIL: 12, PICKUP_CHANCE: 0.26,
  BASE_SPAWN_SLOW: 1.9, BASE_SPAWN_FAST: 0.9,
  SPAWN_RAMP_TIME: 300, EXPEDITION_DURATION: 420,
  CARGO_PICKUP_RADIUS: 38, CARGO_DELIVER_RADIUS: 108,
  CARGO_SPEED_MULT: 0.88, CARGO_DROP_COOLDOWN: 0.9,
  THIEF_STEAL_TIME: 1.4, THIEF_SUPPRESS_TIME: 7,
  FOG_RADIUS: 82, FOG_TTL: 7, FOG_HP: 16,
  FOG_SLOW: 0.48, FOG_OIL_DRAIN: 1.4,
  FOG_WINDUP: 1.1, FOG_COOLDOWN: 4.2, MAX_FOG_ZONES: 8
};
```

### 4.3 模式、地图、长灯配置

```js
MODES.short = {
  key: 'short', name: '短夜巡守', duration: 300
};
MODES.expedition = {
  key: 'expedition', name: '远征长夜', duration: 420
};
```

`MAPS` 有三项：

| key | 名称 | `spawnRateMult` | 特殊规则 |
|---|---|---:|---|
| `village` | 旧村四角 | 1.0 | 无 |
| `forest` | 林间环路 | 1.2 | 更短环路，更高生成压力 |
| `river` | 冻河折线 | 0.95 | `river.yMin/yMax`、两座桥、涉水减速 0.56、油耗 1.5/s |

每张地图包含：`startX/startY`、`braziers`、`cargoPoints`、`thiefPoints`、`weaverPoints`、`theme`。

`LIGHTHOUSE_TYPES`：

| key | 名称 | 修正 |
|---|---|---|
| `classic` | 旧灯 | 全部 1.0，`selectable: false`，仅兼容旧测试 |
| `ember` | 回油灯 | `beamDpsMult: 0.85`、`auraRegenBonus: 2` |
| `ward` | 守夜灯 | `auraRadiusBonus: 25`、`auraDpsBonus: 2`、`beamOilMult: 1.15` |
| `guide` | 引路灯 | `igniteMult: 0.8`、`maxOilBonus: -12`、`showGuide: true` |

### 4.4 创建游戏

```js
createGame({
  seed: 4200,              // 可选；缺省 Date.now() >>> 0
  mode: 'expedition',      // 'short' | 'expedition'
  mapId: 'river',          // 'village' | 'forest' | 'river'
  lighthouseType: 'ember'  // 'classic' | 'ember' | 'ward' | 'guide'
})
```

缺省为 `short` / `village` / `classic`，与第一轮测试完全兼容。非法值回落到缺省。

### 4.5 输入契约

```js
{
  moveX: -1..1,
  moveY: -1..1,
  aimX: -1..1,
  aimY: -1..1,
  focus: boolean,
  interact: boolean,
  dash: boolean
}
```

`game.js` 负责：

- WASD/方向键 → `moveX/moveY` 并归一化；
- 鼠标世界坐标 − 玩家坐标 → `aimX/aimY`；
- 触屏左摇杆 → 移动；右摇杆 → 瞄准 + focus；
- 疾步按钮 / Shift → `dash`；
- 点灯按钮 / E → `interact`。

### 4.6 状态结构（关键字段）

```js
{
  version: '2.0.0',
  phase: 'playing' | 'finale' | 'victory' | 'defeat',
  seed, rngState,
  mode: 'short' | 'expedition',
  mapId, lighthouseType,
  elapsed: 0,
  timeLeft: 300 | 420,
  finaleTime: 0,
  finaleDuration: 20 | 30,
  score, kills, oilCollected, braziersLit,
  player: {
    x, y, aimX, aimY, hp, maxHp, oil, maxOil,
    invuln, dashCooldown, dashTime, dashDirX, dashDirY,
    focusing, beamActive, moving, hitFlash,
    carrying, wading, fogged
  },
  braziers: [
    { id, name, x, y, lit, progress, pulse, flare, suppressed, stolenBy }
  ],
  enemies: [
    { id, type, x, y, hp, maxHp, radius, speed, damage,
      age, flash, slowFactor, knockX, knockY, knockbackScale,
      quest, elite, channel, stolenBrazierId,
      fogCooldown, fogWindup, fogTargetX, fogTargetY }
  ],
  pickups: [ { x, y, age, ttl, amount } ],
  fogZones: [ { id, x, y, radius, hp, maxHp, ttl, age } ],
  expedition: null | {
    stage: 1..5, stageTitle,
    delivered, deliveriesRequired: 5, deliveriesDone,
    cargo: { x, y, index, carried, pickupCooldown } | null,
    cargoIndex, cargoDrops,
    thievesKilled, thievesRequired: 3, thievesSpawned,
    weaversKilled, weaversRequired: 3, weaversSpawned,
    stageStartedAt, fogHintShown, thiefHintShown
  },
  lighthouse: { x, y, progress, auraRadius, pulse },
  spawnTimer, nextEnemyId, nextFogId,
  events: [],
  stats: {
    braziersLit, oilCollected, damageTaken, dashes,
    finaleSurvived, cargoDelivered, thievesSlain,
    fogCleared, weaversSlain, stageBonuses
  }
}
```

### 4.7 更新与查询

```js
update(state, dt, input)
getObjective(state)
getObjectiveTargets(state)
getInteractTarget(state)
getNearestBrazier(state)
getLighthouseDistance(state)
isInteractable(state)
```

要求：

- `dt` 固定为 `1/60`（外层累加器保证），并在 `core` 内再次 clamp 到 `[0, 0.05]`。
- 只允许 `phase === 'playing' || phase === 'finale'` 推进；终局状态直接返回。
- 事件由消费方 `drainEvents()` 取走，核心不主动清空消费前的事件。
- 非法输入归一化，不抛异常。

---

## 5. 第二轮规则实现

### 5.1 模式分流

- `createGame` 根据 `mode` 设置 `timeLeft`、`finaleDuration` 和是否存在 `expedition` 状态。
- `short`：四灯后 `canWake = true`，返塔启动 20 秒守夜。
- `expedition`：只有 `stage === 5` 才允许启动 30 秒守夜。
- 四灯后都会把 `timeLeft` 补到至少 45 秒；远征第 5 段再补到至少 60 秒。

### 5.2 远征阶段机

`startExpeditionStage(state, nextStage)` 只允许向前推进：

| nextStage | 动作 |
|---|---|
| 2 | 清空普通敌人、+1 心、+20 油、生成计时 ≥1.2s；刷第一罐油；+150 分 |
| 3 | 刷第一名任务携灯影（`hpMult: 1.5`、`quest`、`elite`）；+200 分 |
| 4 | 刷第一名任务缠雾者（`hpMult: 1.35`、`fogCooldown: 0.35`）；清空雾带；+200 分 |
| 5 | 清除所有古灯压制与雾带；时间补到 ≥60s；+250 分 |

阶段推进条件：

- 2 → 3：`delivered >= 5`。
- 3 → 4：`thievesKilled >= 3`。
- 4 → 5：`weaversKilled >= 3`。
- 5：玩家在长灯 105 像素内按住交互 0.8 秒。

任务敌人一次只刷一个。每次击杀任务敌人：

- `thievesKilled` / `weaversKilled` +1；
- `stats` 对应计数 +1；
- +1 心、+10 油；
- 清除普通敌人；
- 若未完成，立即在下一个固定点刷下一名。

### 5.3 运油

- 油罐在 `cargoPoints[index]` 生成；玩家进入 38 像素自动背起。
- 携带时 `player.carrying = true`，移动速度 ×0.88。
- 玩家受伤时若携带，油罐掉在脚下，`pickupCooldown = 0.9`，不会消失。
- 进入长灯 108 像素自动交付，+120 分；第 5 罐交付后进入第 3 段。

### 5.4 携灯影窃灯

- 只在远征第 3 段由阶段机生成任务个体；普通生成不出现携灯影。
- 选择最近一座 `lit && suppressed <= 0` 的古灯；目标距离 >700 时改为追玩家。
- 距目标 ≤42 像素时停下引导：
  - `channel` 从 0 累加到 1.4 秒；
  - 每帧发 `thief-channel` 供渲染连线；
  - 完成后 `brazier.suppressed = 7`、`stolenBy = enemy.id`，发 `brazier-stolen`。
- 引导期间目标失效/离开会中断。
- 古灯被压制时：不提供光环、治疗、回油；HUD 对应灯点变暗/红色脉冲。
- 击杀携灯影：恢复对应古灯、+10 油、发 `wick-recovered`；任务个体推进阶段。
- 携灯影免疫古灯光环与最终守夜光环，必须由玩家灯火/微光处理。

### 5.5 缠雾者与雾带

- 普通缠雾者从远征第 2 段起可进入生成表，权重 14；第 3 段起 20；最终守夜 10。
- 任务缠雾者只在第 4 段生成，`fogCooldown` 首次 0.35 秒。
- 行为：
  - 接近玩家后进入 1.1 秒 `fogWindup`，目标点锁在玩家当前位置；
  - 发 `fog-telegraph`；
  - 完成后在目标点创建 `fogZones`（半径 82、HP 16、TTL 7、上限 8），发 `fog-created`。
- 雾带效果：
  - 玩家在雾内 `fogged = true`，速度 ×0.52；
  - 每秒 -1.4 油；
  - 灯火锥命中雾带时按 `getBeamDps(state)` 扣 HP；
  - 清空后 +12 分，发 `fog-cleared`。
- 缠雾者死亡：清空所有雾带，发 `fog-dissolved`。
- 任务缠雾者免疫古灯/长灯光环，防止挂机自动完成第 4 段。

### 5.6 冻河

`player.wading` 由地图 `river.yMin/yMax` 与桥面区间决定：

```js
var inRiver = y >= river.yMin && y <= river.yMax;
var onBridge = river.bridges.some(function (b) {
  return x >= b.xMin && x <= b.xMax;
});
player.wading = inRiver && !onBridge;
```

涉水时：

- 移动速度 ×0.56；
- 每秒 -1.5 油；
- HUD 状态标签显示「涉水 · 减速」。

### 5.7 长灯类型

所有修正通过查询函数统一生效，避免在规则各处散落判断：

```js
getBeamDps(state)            // 21 * beamDpsMult
getBeamOilPerSec(state)      // 18 * beamOilMult
getBrazierAuraRadius(state)  // 110 + auraRadiusBonus
getBrazierAuraDps(state)     // 5 + auraDpsBonus
getBrazierAuraRegen(state)   // 3 + auraRegenBonus
getIgniteTime(state)         // 1.8 * igniteMult
player.maxOil                // 100 + maxOilBonus
```

引路灯的目标方向线由 `getObjectiveTargets(state)` 提供，渲染层只在 `showGuide` 时绘制，不改变规则。

### 5.8 修复：接触击退产生 NaN

第二轮多种子模拟暴露了一个第一轮未覆盖的运行时缺陷：

- `spawnEnemy` 创建敌人对象时漏拷 `knockbackScale`；
- 玩家与敌人接触时，`enemy.knockX = ... * enemy.knockbackScale`，乘数为 `undefined`；
- 结果 `knockX/knockY` 变成 `NaN`，敌人坐标随后变成 `NaN`；
- 第 4 段任务缠雾者可能因此卡住，阶段无法推进。

修复：在 `spawnEnemy` 返回对象中写入 `knockbackScale: type.knockbackScale`。  
回归：`tests/core.test.js` 的长时间随机输入测试与 `tests/balance-sim.js` 的 36 种子远征模拟都断言所有坐标/击退值有限。

---

## 6. 主循环与输入

### 6.1 固定步长

```js
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (screen === 'playing' && !paused) {
    acc += raw;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      NightCore.update(state, STEP, currentInput());
      acc -= STEP;
      steps++;
    }
  }
  updatePresentation(raw);
  render(now / 1000);
}
```

暂停和失焦：

- `paused = true` 时停止调用 `update`，把累加器清零。
- `visibilitychange` + `window.blur` 自动暂停。
- 暂停时 `audio.suspend()`；恢复时 `audio.resume()`。
- 清空输入并释放所有指针捕获，防止恢复后持续移动/亮灯。
- 暂停/重开/结算会调用 `clearTransientUI()`，清空 toast/hint 的文本、定时器、类名与 `aria-hidden` 状态。

### 6.2 移动与碰撞

- 输入向量长度 clamp 到 1。
- 速度 = `PLAYER_SPEED` × focus 修正 × 携带灯油修正 × 涉水/雾减速。
- 位置积分后 clamp 到地图边界。
- 灯塔圆形碰撞：半径 46，玩家半径 15；用最近点推出。
- 暗影可穿过建筑（影子无实体），只与玩家产生距离碰撞。

### 6.3 灯光判定

对每只敌人取以下来源的最高 DPS，而不是叠加：

1. **基础微光**：距玩家 ≤92，2 DPS。
2. **灯火锥**：`focusing && oil > 0`，距离 ≤330，且 `dot(normalize(enemy - player), aim) ≥ cos(21°)`，`getBeamDps(state)`。
3. **古灯光环**：距任一已点亮且未被压制古灯 ≤`getBrazierAuraRadius(state)`，`getBrazierAuraDps(state)`。
4. **长灯守夜光环**：`phase === 'finale'`，距灯塔 ≤`auraRadius`，6 DPS。

携灯影与任务缠雾者强制忽略第 3、4 项。减速取最高值：灯火 35%、古灯 30%、长灯 25%。

### 6.4 伤害与无敌

- 接触距离 = 玩家半径 + 敌人半径。
- 若 `invuln <= 0` 且发生接触：
  - `hp -= damage`；
  - `invuln = 1.1`；
  - 玩家击退 28 像素，敌人击退 20 × `knockbackScale`；
  - 发 `player-hit`；
  - 若携带灯油，掉落；
  - 若 `hp <= 0` → `phase = 'defeat'`、发 `defeat`。
- 无敌期间角色闪烁，但依旧可以移动/攻击。
- 疾步前 0.18 秒无敌。

### 6.5 古灯交互

1. 找到 82 像素内最近的未点亮古灯。
2. 若 `interact` 且 `oil >= 15`：
   - `progress += dt`；
   - 达到 `getIgniteTime(state)`：点亮；
   - 扣除 15 油，再恢复 30 油（上限 `maxOil`），恢复 1 点生命（上限 4）；
   - `progress = 0`；发 `brazier-lit`；
   - 玩家不因点亮被定身。
3. 若松开或离开范围：`progress = max(0, progress - dt * 0.5)`。
4. 灯油不足时按住交互：发一次限频 `oil-empty` 事件，不积累进度。

### 6.6 最终守夜

- 条件：四灯全亮；短夜直接可唤醒，远征必须第 5 段；距灯塔 ≤105；按住交互 0.8 秒。
- 进入 `finale`：
  - `finaleTime = 0`；
  - `timeLeft = max(timeLeft, 45)`；
  - 光环半径从 120 开始，按进度增长至 210；
  - 发 `lighthouse-start`。
- 守夜时长：短夜 20 秒，远征 30 秒。
- 生成间隔 0.58 秒；远征最终守夜混入 10% 缠雾者。
- 光环对范围内敌人造成 6 DPS，并给玩家每秒 3 点灯油恢复。
- 剩余 5 秒每秒发 `finale-tick` 供心跳音效。
- 玩家生命归零 → 失败。
- `finaleTime >= finaleDuration` → 胜利，+500 与剩余时间 ×5，发 `victory`。

### 6.7 倒计时

- `timeLeft` 在 `playing` 与 `finale` 都递减。
- `timeLeft <= 0` 且未胜利 → 失败，原因 `dawn`。
- HUD 在最终守夜阶段显示「黎明将至」与当前守夜剩余秒数，而不是普通倒计时。

### 6.8 敌人生成

```js
const progress = clamp(elapsed / 300, 0, 1);
const base = lerp(1.9, 0.9, progress);
const lit = litCount;
const interval = base / (1 + lit * 0.15) / map.spawnRateMult;
```

- 最终守夜固定 0.58 秒。
- 首 4 秒宽限。
- 出生点在地图四边外 20–70 像素；抽 6 次，优先远离玩家（<260 像素扣分）。
- 活跃敌人达到 46 时跳过生成；任务敌人可用 `force` 突破到 50。
- 远征第 2 段起，普通生成表加入缠雾者；携灯影不入普通表。

---

## 7. 渲染与界面

### 7.1 坐标与缩放

- 逻辑世界 1280×720。
- Canvas backing store 按 CSS 显示尺寸 × `min(devicePixelRatio, 2)` 设置。
- `renderScale = canvas.width / 1280`，统一变换后使用逻辑坐标。
- CSS 等比居中；竖屏时画布在中间，HUD 与摇杆落在上下留白区。
- 屏幕输入通过 `getBoundingClientRect()` 反算世界坐标。

### 7.2 静态背景

启动/切图时创建离屏 Canvas，绘制：

- 深色渐变地面；
- 放射状小径与石阶；
- 固定种子碎草、卵石、灰烬；
- 中央灯塔石台；
- 四角古灯石座；
- 地图专属层次：
  - 旧村：屋脊、枯松；
  - 林间：环形林带、树冠、林间空隙；
  - 冻河：冰面、两座窄桥、芦苇、冰裂纹。

每帧 `drawImage(bg, 0, 0)`；前景树带单独绘制在实体之后。

### 7.3 每帧绘制顺序

1. 背景缓存；
2. 地面光斑与路径微光；
3. 任务目标线 / 油罐 / 古灯；
4. 暗影、拾取物、玩家（按 y 排序）；
5. 前景树影；
6. 灯火锥与所有光源；
7. 雾带、雾预警、边缘暗角；
8. 粒子；
9. 屏幕震动偏移；
10. 终局黎明滤镜；
11. 交互圆环 / 窃灯连线 / 目标方向提示。

### 7.4 第二轮视觉表现

- **携灯影**：紫黑轮廓、灯芯亮点；窃灯时与古灯之间画红色/橙色拉扯线，古灯转暗并闪红。
- **缠雾者**：蓝灰轮廓、雾团粒子；落雾前画虚线圈与 1.1 秒进度，落雾后画半透明蓝雾、中心「雾」字与 HP 条。
- **油罐**：暖橙罐体、提手、微光；携带时跟在玩家背后，交付时上浮消散。
- **阶段脉冲**：换段时灯塔方向扩散一圈暖光，HUD 5 段点亮。
- **引路灯**：从玩家指向当前目标的金色虚线，目标变化时更新。
- **冻河**：水面反光、桥面木板、涉水时玩家脚下水纹与「涉水 · 减速」标签。

### 7.5 HUD 更新策略

缓存上一次值，只有变化时更新 DOM：

- `hp` → 心形容器 class；
- `oil` → `style.width`；
- `timeLeft` → 每 0.1 秒更新文本；
- `score` → 每 0.2 秒更新；
- `objective` → 字符串变化时更新；
- 四灯点 / 5 段点 → class；
- 模式 chip、地图/长灯摘要 → 进入游戏或换段时更新。

### 7.6 屏幕状态机

```
title ──开始守夜/远征模式──> prep ──踏入长夜──> playing
  ↑                           │
  ├──────── 返回标题 ─────────┤
  │                           ├─ hp<=0 ──> defeat ──重试──> playing
  │                           ├─ time<=0 ─> defeat
  │                           └─ 守夜结束 ─> victory ──再守一夜──> playing
  └──────────────── 返回标题 ──┘
```

- 进入 `playing` 时创建全新 core state。
- `screen === 'playing'` 且 `state.phase === 'victory'/'defeat'` 时，延迟 0.8 秒展示结算覆盖层。
- 结算覆盖层打开后清空输入并暂停音频紧张层。
- 重开会重置 `braziersLit`、计时、雾带、任务状态、输入与 toast/hint。

---

## 8. 音频

- 首次点击「开始守夜」时创建 `AudioContext`。
- 主音量 0.5，压缩器防削波。
- 环境层：55 Hz 正弦 + 82.5 Hz 三角波 + 低通噪声风声。
- 灯火层：带通噪声，随 focus 平滑过渡。
- 新事件复用现有音色，未新增独立合成器：
  - `cargo-picked` / `cargo-delivered`：`pickup()`；
  - `cargo-dropped` / `brazier-stolen`：`hit()`；
  - `thief-channel`：`oilEmpty()` 低频提示；
  - `brazier-restored`：`ignite()`；
  - `fog-cleared`：`pickup()`；`fog-dissolved`：`hit()` + 散开粒子。
- 页面隐藏时 `audio.suspend()`；静音只把主增益设为 0。

---

## 9. 存档

使用 `localStorage`，所有访问包裹 `try/catch`（`file://` 下可能被禁用，游戏必须仍可玩）。

| key | 值 |
|---|---|
| `night_bestScore` | 短夜最高分 |
| `night_bestElapsed` | 短夜最快通关秒数 |
| `night_bestScore_expedition` | 远征最高分 |
| `night_bestElapsed_expedition` | 远征最快通关秒数 |
| `night_muted` | `'1'` / `'0'` |
| `night_shake` | `'1'` / `'0'` |
| `night_mode` | `'short'` / `'expedition'` |
| `night_map` | `'village'` / `'forest'` / `'river'` |
| `night_lighthouse` | `'ember'` / `'ward'` / `'guide'` |
| `night_seen_expedition` | 是否已提示远征入口 |

标题页显示两种模式的最佳记录。旧短夜记录仍读取 `night_bestScore` / `night_bestElapsed`，不会被远征记录覆盖。

---

## 10. 测试与验收

### 10.1 静态检查

```bash
node --check js/core.js
node --check js/audio.js
node --check js/game.js
```

### 10.2 核心单元测试

`tests/core.test.js` 使用 `node:test`，共 **28 项**：

- 原 19 项：初始状态、移动/边界、灯塔碰撞、灯火锥、油耗、点灯、回退、油不足、四灯补时、古灯光环、无敌帧、疾步、拾取、倒计时失败、生命失败、最终守夜胜利/失败、种子复现、万帧随机输入。
- 新增 9 项：
  1. 模式/地图/长灯配置可复现且互不相同；
  2. 三类长灯各有可观察取舍；
  3. 冻河涉水变慢并耗油，桥面不受影响；
  4. 远征四灯后进入运油，灯塔尚不可启动；
  5. 远征依次完成运油、携灯影、缠雾者后回塔获胜；
  6. 携灯影会窃取古灯，击杀后归还灯芯；
  7. 缠雾者预警后生成雾气，减速并可用灯火驱散；
  8. 携带灯油时受伤会掉落，可重新拾取；
  9. 长时间输入在远征/冻河/引路灯配置下仍无非法状态。

运行：

```bash
node --test tests/core.test.js
```

### 10.3 多种子模拟

```bash
node tests/balance-sim.js 36 expedition
node tests/balance-sim.js 30 short
```

模拟只作平衡信号，不冒充真实试玩。远征模拟使用脚本控制器，完成时间明显短于实际浏览器自动化流程，不能用来证明“3–5 分钟”。

### 10.4 浏览器回归

`tests/ui-regression.cjs` 使用 Playwright Core + 本机 Chrome，覆盖：

- 当前 toast 的 `role=status`、`aria-hidden=false`、可访问树文本；
- 暂停清空；
- 重开清空文本、类名、`aria-hidden`；
- 连续 10 次重开不复活；
- 失焦暂停并清空持按键；
- 控制台/页面错误。

运行（依赖装在临时目录，不随游戏交付）：

```powershell
$env:NODE_PATH="$env:TEMP\night-game-playwright\node_modules"
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
node tests/ui-regression.cjs
```

### 10.5 调试接口

仅在 URL 带 `#debug` 时暴露：

```js
window.__NIGHT_DEBUG__ = {
  getState, getScreen, getTarget,
  startGame, teleport, setOil, setTime, setHp,
  fillBraziers, advanceFinale, damagePlayer
};
```

正式入口（不带 `#debug`）不暴露这些接口。调试接口只用于验收与排障，不改变正式数值。

---

## 11. 性能与稳定性

- 固定 60Hz 逻辑，渲染跟随刷新率。
- 单帧最多 5 个逻辑步，防止后台恢复后爆炸。
- 敌人上限 46（任务敌人最多 50），粒子上限 420，拾取物上限 10，雾带上限 8。
- 静态背景预渲染；径向渐变光源数量有限。
- HUD 做脏检查，避免每帧写 DOM。
- 单一 rAF 主循环，不叠加多个定时器。
- 所有数组倒序遍历删除。
- 数值 clamp；`knockbackScale` 回归修复后，测试断言坐标/击退值全部有限。
- `visibilitychange` 与 `blur` 自动暂停。
- 不支持 WebAudio 时静默降级。

第二轮性能采样（headless Chrome，1280×720，DPR1，40 个强制敌人 + 特效，3 秒）：

- 187 帧 / 3008ms，约 62.2 fps；
- JS heap 约 6.5MB；
- 无控制台/页面错误。

该数字只代表该环境的一次采样，不等同于所有真实设备稳定 60FPS。

---

## 12. 第二轮实施顺序

| 阶段 | 工作 | 产出 |
|---|---|---|
| 0 | 复现 P0、读旧测试与规则 | 缺陷清单、验收映射 |
| 1 | toast 生命周期 + P0 回归 | `clearTransientUI`、`ui-regression.cjs` |
| 2 | 模式/地图/长灯数据结构 | `MODES`、`MAPS`、`LIGHTHOUSE_TYPES` |
| 3 | 远征阶段、运油、携灯影、缠雾者 | 五段完整流程 |
| 4 | 渲染/HUD/触屏/出发准备页 | 可玩的双模式界面 |
| 5 | 单元测试、多种子模拟、NaN 修复 | 28 项测试、36+30 种子 |
| 6 | 浏览器试玩、响应式、性能、截图、文档 | 交付版 |

---

## 13. 已知限制

- 浏览器流程由自动化控制器完成，**不是人类手动试玩**；未做实体手机、读屏器、Safari/Firefox 实测。
- 性能数据来自 headless Chrome 单次采样，不能外推为所有设备稳定 60FPS。
- 远征模拟控制器完成时间约 82 秒，明显短于实际浏览器自动化流程 203.7 秒；模拟只用于规则与非法状态检查。
- 音效只验证了无异常与静音开关，未做声学/听觉验收。
- 未做数小时长时间运行与内存增长测试。

---

## 14. 交付定义

- 工作区内包含完整可运行的 `index.html`。
- 直接双击打开可玩；不要求启动服务器。
- 设计文档、开发文档与实际实现一致；数值变更同步更新本文档。
- 测试报告明确区分单元测试、模拟、浏览器自动化与未验证项。
