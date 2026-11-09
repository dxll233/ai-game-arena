# 《霓虹防线 NEON DEFENSE》开发文档

| 项目 | 内容 |
| --- | --- |
| 版本 | v3.0.1（2026-11-05，含中小视口布局热修） |
| 开发模式 | 先文档后开发（GDD 见 DESIGN.md）；重大改动前先独立备份（BACKUP_MANIFEST.md） |
| 技术栈 | HTML5 Canvas + 原生 JavaScript + WebAudio + localStorage，零依赖 |

## 1. 技术选型与理由

| 决策 | 理由 |
| --- | --- |
| 单文件 `index.html`（内联 CSS/JS） | 双击即玩、零部署、零路径问题，便于分享；发布版即此文件的副本 |
| 原生 JS + Canvas 2D | 塔防逻辑简单、实体数量少（<60），无需框架；无构建步骤 |
| 程序化绘制（无图片素材） | 保证单文件自包含；霓虹几何风格与代码生成天然契合 |
| WebAudio 程序化音效 | 无音频文件；振荡器+噪声缓冲覆盖全部音效；主增益统一缩放支持音量 |
| DOM 承载 HUD，Canvas 只画战场 | 文字/按钮清晰；Canvas 专注实体与特效 |
| localStorage 存档（版本+校验） | 解锁/纪录/设置持久化；坏档容错，不阻断游戏 |

## 2. 目录结构

```
neon-defense/
├── DESIGN.md               设计文档（GDD，v3.0：含情报系统/存档/引导设计）
├── DEV.md                  本文档
├── README.md               项目总览与快速开始
├── 玩家操作说明.md          玩家向操作说明（启动/目标/操作/存档/平台/重开）
├── 已知问题.md              剩余问题、测试范围与未覆盖项
├── ROUND2_CHANGELOG.md     改动清单（v1.0→v2.0→v3.0→v3.0.1 全演进）
├── TEST_REPORT_ROUND2.md   验收测试报告（A0-A8 逐项+证据）
├── BACKUP_MANIFEST.md      升级前基线备份记录（位置/哈希/恢复方法）
├── index.html              游戏本体（唯一源码文件，内联全部代码）
├── 发布版/
│   └── 霓虹防线.html       玩家可运行版本（与 index.html 相同，随附操作说明）
├── tools/
│   ├── simulate.js         Node 无头仿真测试（A1/B1/B2/B3/B4/C1-C4 全量断言）
│   └── simulate_output.log 最近一次全量测试输出（169 项通过）
└── screenshots/
    └── round2/             38 张试玩截图（17 张 v2.0 历史 + 16 张 v3.0 + 5 张 v3.0.1 修复）+ 2 份 JSON 结果
```

## 3. 运行方式

- 直接双击 `index.html`，使用 Chrome、Edge、Firefox 或 Safari 打开。无需安装或联网。
- 自动化测试：`node tools/simulate.js`（无需浏览器，零依赖，约 1-2 分钟）。
- 玩家向说明见《玩家操作说明.md》；验收证据见 TEST_REPORT_ROUND2.md。

## 4. 代码架构（index.html 内部分节）

```
┌─ 工具函数 clamp/lerp/dist/roundRect
├─ 配置层   MAPS(3张地图)、TOWERS(levels+branches)、ETYPES(6类敌人)、WAVES(20波)
├─ 状态层   G（phase/money/lives/wave/score/towers/enemies/effects/mapIdx/seen...）
├─ 存档层   Save（v3：版本号+FNV校验+默认值+旧档迁移+坏档容错+隐私模式降级）
├─ 情报层   CODEX(图鉴数据)/enemyTags/waveThreat/threatStars/waveChips
│           WAVE_HINTS(分阶段引导)/FIRST_SEEN(首遇提示)/toast(Toast组件)
├─ 系统层
│   ├─ 地图系统   setMap(idx) 重建路径分段/核心坐标；切图影响寻路与建造判定
│   ├─ 路径系统   posAt(d) 按里程取坐标；minDistToPath() 建造判定
│   ├─ 生成系统   spawnEnemy 波次缩放、bossHpAt 统一公式、BOSS 分裂、首遇提示
│   ├─ 战斗系统   towerStats(分支优先)、findTargets、damage(护盾→护甲→穿透)、fire(multi/pierce)、updateTowers(停火跳过/激光多束/霜爆周期)
│   ├─ 进阶系统   chooseBranch(t,key) 互斥分支（Lv.2 二选一）
│   ├─ 特殊敌人   冲锋体状态机(撞塔48px停火3s)；护盾节点周期施法(100px/3.5s/50%减伤)
│   ├─ 技能系统   overdrive（单塔）、emp（全场冻结，可中断冲锋/施法）
│   ├─ 经济系统   tryBuild/upgradeTower/sellTower(投入60%)/清波奖励/提前开波
│   ├─ 流程系统   startGame/gameOver(纪录+复盘)/victory(纪录+解锁)/toMenu(状态清理)/refreshMapCards
│   └─ 特效系统   burst/spark/tracer/ring/floatText + 屏幕震动
├─ 渲染层   drawBg/drawPath/drawCore/drawTowers(分支外观)/drawEnemies(护盾泡/蓄力预警)/drawFx/drawFloats/drawMapPreview
├─ HUD 层   syncHUD（变化检测）、renderSelPanel(分支按钮)、renderPreview(下一波)、renderIntel(未来3波)、renderTimeline(20波)、renderCodex(图鉴)
├─ 音频层   Snd（WebAudio 程序化音效 + 节流 + 音量增益 + 倍速抽稀）
├─ 入口层   boot（Save.load/applySettings/事件绑定/地图卡）/ frame（rAF 主循环）/ update
└─ 调试导出 window.__ND={G,TOWERS,ETYPES,WAVES,MAPS,PATH_LEN,CORE,api,Save,CODEX,Snd,
    waveThreat,threatStars,enemyTags,codexFeat,renderIntel,renderTimeline,renderCodex}
```

**主循环**：`requestAnimationFrame` → `dt`（截断 50ms）→ 按倍速重复 `update(dt)` → `syncHUD()` → `render()`；倍速时 `Snd.gap=2` 抽稀音效。

**状态机**：`menu → playing ⇄ paused → gameover / victory`（均可重开或回菜单；toMenu 清理 selected/buildType/hover）。

## 5. 关键算法

1. **路径移动**：敌人只存里程 `dist`，`posAt(dist)` 在预计算分段上线性插值，O(段数)，支持"最靠前优先"索敌。
2. **地图配置化**：`MAPS` 持有每张图路径点/核心/hpMul/turns；`setMap(idx)` 重建 `SEGS`/`PATH_LEN`/`CORE`。
3. **建造判定**：格中心距路径 ≥38px、距核心 ≥70px 才可建。
4. **索敌**：`findTargets(t,range,n)` 按 `dist` 从大到小取前 n 个；对空/对地互斥。
5. **进阶分支**：`towerStats(t)` 分支优先，否则共享等级；Lv.2 无分支不越界。
6. **伤害结算链**：护盾减半 → 护甲-穿透 `max(1, amt-max(0,armor-pierce))`（999=无视护甲）→ 保底 1。
7. **冲锋体状态机**：行走 2.5s → 蓄力 1.0s（×0.12 速度+闪圈预警）→ 冲锋 1.6s（×3.2，撞 48px 内塔停火 3s）→ 休息 4s；EMP 眩晕重置。
8. **护盾节点施法**：每 5.5s 为 100px 内地面单位附加 3.5s 50% 减伤；眩晕冻结 castCd。
9. **威胁评级**：`waveThreat(w)` = Σ 敌人数 × 基础生命 × 波次缩放 × 地图 hpMul（Boss 另乘节点倍率与终局倍率），`threatStars` 归一化到 1-5 星——与 `spawnEnemy` 实际 HP 同源，保证情报不骗人。
10. **存档校验**：FNV-1a 哈希覆盖除 `sum` 外全字段；读取时校验版本号+哈希，失败回退默认；`merge()` 白名单合并（未知地图 id 忽略），保证旧档/局部档安全。

## 6. 开发里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 设计文档 + 开发文档 | 已完成 |
| M2 | 核心循环：路径、生成、索敌、开火、经济、胜负 | 已完成 |
| M3 | 内容：20 波次表、4 塔进阶、6 敌人、BOSS 分裂 | 已完成 |
| M4 | 打磨：特效、音效、HUD、过载/EMP、暂停/倍速/静音 | 已完成 |
| M5 | QA：Node 仿真测试 + 平衡调优 | 已完成（第一轮：剩余 10 生命通关） |
| M6-M10 | 第二轮：Boss 公式统一 / 3 地图 / 四塔互斥分支 / 特殊敌人 / 三图机器人平衡 | 已完成（三地图各剩 15 生命） |
| M11 | 第二轮：真实浏览器试玩、截图、性能与布局实测 | 已完成（30 项试玩全过） |
| M12 | 第三轮：独立备份 + 基线复核（BACKUP_MANIFEST.md） | 已完成 |
| M13 | 第三轮：敌军情报系统（面板/时间线/图鉴/首遇教学） | 已完成 |
| M14 | 第三轮：存档系统（版本/校验/迁移/容错）+ 地图解锁 + 纪录 | 已完成 |
| M15 | 第三轮：音量控制 + 倍速抽稀 + 失败复盘 + 引导完善 | 已完成 |
| M16 | 第三轮：回归扩展（169 项）+ 浏览器试玩 27 项 + 发布版 | 已完成 |
| M17 | 热修 v3.0.1：中小视口开始按钮不可见（flex-shrink 压缩+地图卡竖排+absolute 弹层）；6 视口复测通过、双测试无回归 | 已完成 |

## 7. 测试方案

`tools/simulate.js` 以 Proxy 桩替换 DOM/Canvas/Audio/localStorage 后加载游戏脚本，驱动**真实游戏逻辑**（非重放）：

| 编号 | 场景 | 断言要点 |
| --- | --- | --- |
| A1 | Boss 公式统一 | 波 20 波、Boss 5/10/15/20、单 Boss、运行时 HP=公式=文档表 |
| B1 | 三地图 | 长度/核心/拐点互异；终点=核心；建造判定；切图不继承 |
| B2 | 互斥分支 | 四塔 A/B 可选、互斥锁定、资金拦截、出售 60%、分支数值逐项生效、重开/切图重置 |
| B3 | 特殊敌人 | 首见波次、护盾减半/空中不获盾/激光不穿盾/EMP 断施法/自然消退；冲锋预警/撞塔停火/停火不开火/过载不解停火/EMP 中断/控制有界 |
| B4 | 回归 | 过载/EMP 冷却不变、暂停、提前开波、BOSS 分裂、路径检查、无塔必败、三地图机器人通关、API 冒烟 |
| C1 | 敌军情报（v3） | 威胁递增/星级边界/六类标签/图鉴完整/情报面板 3 波/时间线 20 波+4 BOSS/首遇记录与 Toast/第 6 波引导 |
| C2 | 存档（v3） | 默认值/往返/损坏/版本不符/篡改/迁移/局部合并/未知地图 id/纪录单调/解锁推进 |
| C3 | 集成（v3） | 胜利写纪录+解锁、失败写最佳波次、返回菜单清理状态 |
| C4 | 音量（v3） | 静音按钮切换+生效+持久化、滑块 0-100% 写入、音效节流 |

**机器人策略**（同 simulate.js 与浏览器试玩，只用界面可用操作）：EMP 在 Boss 在场或敌人≥8 时释放；过载给击杀最高的塔；**分支优先**（Lv.2 立即进阶）；随后升级；塔数未达 `5+⌊波次×0.45⌋` 时补塔。平衡判据：三地图全部 victory 且剩余生命 8-20。

## 8. 已知风险与应对

| 风险 | 应对 |
| --- | --- |
| 数值不平衡 | 仿真机器人量化验收（三地图各跑一遍），按结果调参 |
| 后期实体过多掉帧 | 实体上限受波次表约束（<60），特效短生命周期；性能实测（最坏负载 18 塔+35 敌：最低 68/平均 84.7 FPS） |
| 坏档阻断游戏 | 版本+校验+默认值+迁移四道防线，全部测试覆盖 |
| 局内存档复杂度 | 明确不支持局内续玩（设计决策，文档声明） |
| 移动端体验 | 仅保证桌面键鼠；390×844 布局无溢出但未真机验证，未宣称支持 |
| 仿真与人工试玩的边界 | 仿真/页面内机器人为自动证据，不冒充人工通关；未覆盖项在已知问题.md 如实列出 |
