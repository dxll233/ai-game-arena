'use strict';

/* ============ 全部数值配置（与设计文档一致） ============ */

const CONFIG = {
  W: 960,
  H: 600,

  player: {
    maxHp: 100,
    speed: 260,
    r: 15,
    pickup: 70,
    invuln: 1.2,
  },

  dash: { mult: 3.2, dur: 0.16, cd: 2.2 },

  xp: { base: 8, perLevel: 7 },
  score: { kill: 10, time: 5, level: 25 },
  winTime: 300,

  spawn: {
    baseInterval: 1.45,
    intervalDecay: 240,
    minInterval: 0.28,
    maxAlive: 260,
    eliteFrom: 60,
    eliteEvery: 45,
    bossFirst: 150,
    bossEvery: 105,
    /* v2.0.1 难度调整：75→110（中期 75~110s 维持 1/波，缓解怪群堆积墙，见 ROUND2_CHANGELOG） */
    perWave(t) { return 1 + Math.floor(t / 110); },
  },

  scaling: {
    /* v2.0.1 难度调整：60×0.55→90×0.5（中期承压约 -20%，后期仍线性增长） */
    hp(t) { return 1 + t / 90 * 0.5; },
    speed(t) { return 1 + t / 300 * 0.25; },
    dmg(t) { return 1 + t / 120 * 0.35; },
  },

  /* ---- 敌人 ---- */
  enemies: {
    mote:    { name: '墨点', hp: 20,  speed: 88,  dmg: 7,  r: 13, xp: 2,  unlock: 0,   weight: 10, color: '#2c2731', ranged: false },
    dart:    { name: '疾影', hp: 14,  speed: 175, dmg: 9,  r: 11, xp: 3,  unlock: 45,  weight: 6,  color: '#5b3a86', ranged: false },
    spitter: { name: '墨刺', hp: 34,  speed: 72,  dmg: 11, r: 14, xp: 4,  unlock: 60,  weight: 5,  color: '#1d6b74', ranged: true },
    brute:   { name: '磐石', hp: 95,  speed: 58,  dmg: 17, r: 20, xp: 6,  unlock: 75,  weight: 4,  color: '#3c4a58', ranged: false },
    lancer:  { name: '裂锋客', hp: 52, speed: 120, dmg: 12, r: 13, xp: 5, unlock: 75,  weight: 5,  color: '#a02f38', ranged: false, lancer: true },
    veil:    { name: '墨幕使者', hp: 72, speed: 95, dmg: 10, r: 15, xp: 6, unlock: 90,  weight: 4,  color: '#28566b', ranged: false, caster: true },
    boss:    { name: '墨君', hp: 1200, speed: 72, dmg: 26, r: 38, xp: 60, unlock: 150, weight: 0,  color: '#221a2e', ranged: false, boss: true },
  },

  /* v2.0.1 难度调整：精英血量系数 4.5→3.2（t=100 时精英磐石约 820→470hp，避免中期血量黑洞） */
  elite: { hp: 3.2, speed: 1.12, dmg: 1.6, r: 1.35, xp: 8 },

  /* ---- 新敌人机制参数 ---- */
  lancer: {
    engageDist: 300,   /* 进入瞄准的距离 */
    aimTime: 0.9,      /* 蓄力预警时长（方向在蓄力开始时锁定） */
    dashSpeed: 620,    /* 冲刺速度（直线不可转向） */
    dashTime: 0.42,
    recoverTime: 0.9,  /* 冲刺后硬直 */
    dashDmgMult: 1.5,  /* 冲刺接触伤害倍率 */
  },
  veil: {
    keepDist: 260,     /* 与玩家保持的距离 */
    castEvery: 5.0,    /* 施放墨幕间隔 */
    castTime: 1.1,     /* 预警时长 */
    zoneR: 95,
    zoneDur: 6,
    zoneSlow: 0.75,    /* 玩家在墨幕内移速倍率 */
  },
  zone: {
    tick: 0.5,         /* 有害地面每跳伤害间隔 */
  },

  /* ---- Boss 两阶段 ---- */
  boss2: {
    phase2HpFrac: 0.5, /* 生命低于该比例进入第二阶段（仅一次） */
    ringEvery: 4.0,    /* 一阶段环形弹幕间隔 */
    fanEvery: 2.6,     /* 二阶段扇形墨弹间隔 */
    fanCount: 7,
    fanSpeed: 250,
    poolEvery: 5.5,    /* 二阶段地面墨痕间隔 */
    poolTelegraph: 1.0,
    poolR: 110,
    poolDur: 4.5,
    poolDmg: 12,
    phase2SpeedMult: 1.25,
  },

  /* ---- 武器进化（三种，效果见设计文档） ---- */
  evolution: {
    orbit:  { ringEvery: 3.2, ringRadius: 230, dmgMult: 1.6, burnDur: 2.5, burnDps: 10 },
    bolt:   { arrayEvery: 5, arrayCount: 5, spread: 0.55 },
    thunder: { detonateDelay: 1.2, dmgMult: 0.85, radius: 75 },
  },

  /* ---- 武器（levels 数组下标 = 等级-1） ---- */
  orbit: {
    name: '符火',
    levels: [
      { count: 2, dmg: 20 },
      { count: 2, dmg: 24 },
      { count: 3, dmg: 28 },
      { count: 3, dmg: 33 },
      { count: 4, dmg: 38 },
    ],
    radius: 95, angular: 2.4, orbR: 10, hitCd: 0.4,
  },

  bolt: {
    name: '飞星',
    levels: [
      { count: 1, dmg: 11, rate: 1.1, pierce: 1 },
      { count: 1, dmg: 15, rate: 1.2, pierce: 1 },
      { count: 2, dmg: 15, rate: 1.3, pierce: 1 },
      { count: 2, dmg: 17, rate: 1.6, pierce: 2 },
      { count: 3, dmg: 19, rate: 1.6, pierce: 2 },
    ],
    speed: 460, r: 6, range: 700,
  },

  thunder: {
    name: '雷印',
    levels: [
      { dmg: 34, interval: 3.2, chain: 1 },
      { dmg: 42, interval: 2.9, chain: 1 },
      { dmg: 48, interval: 2.7, chain: 2 },
      { dmg: 58, interval: 2.4, chain: 2 },
      { dmg: 70, interval: 2.2, chain: 3 },
    ],
    aoe: 55,
  },

  aura: {
    name: '墨潮',
    levels: [
      { radius: 100, dmg: 6 },
      { radius: 112, dmg: 7.5 },
      { radius: 125, dmg: 9 },
      { radius: 138, dmg: 11 },
      { radius: 150, dmg: 14 },
    ],
    tick: 0.5,
  },

  frost: {
    name: '冰棱',
    levels: [
      { dmg: 8,  interval: 5.0 },
      { dmg: 10, interval: 4.6 },
      { dmg: 13, interval: 4.0 },
      { dmg: 16, interval: 3.6 },
      { dmg: 20, interval: 3.2 },
    ],
    radius: 150, slow: 0.55, slowDur: 2.5,
  },
};

/* ============ 升级三选一卡池 ============ */

const UPGRADE_POOL = [
  /* --- 武器（可升至 5 级，未持有时权重更高） --- */
  {
    id: 'orbit', type: 'weapon', name: '符火', icon: '火',
    desc: p => p.weapons.orbit === 0
      ? '解锁环绕符火，绕身旋转灼烧贴近之敌'
      : '火苗数量与伤害提升（Lv' + p.weapons.orbit + ' → ' + (p.weapons.orbit + 1) + '）',
  },
  {
    id: 'bolt', type: 'weapon', name: '飞星', icon: '星',
    desc: p => p.weapons.bolt === 0
      ? '解锁飞星弹，自动射向最近的敌人'
      : '星弹数量 / 伤害 / 射速提升（Lv' + p.weapons.bolt + ' → ' + (p.weapons.bolt + 1) + '）',
  },
  {
    id: 'thunder', type: 'weapon', name: '雷印', icon: '雷',
    desc: p => p.weapons.thunder === 0
      ? '解锁雷印，定期劈落雷电轰击敌人'
      : '雷击伤害 / 频率 / 连锁提升（Lv' + p.weapons.thunder + ' → ' + (p.weapons.thunder + 1) + '）',
  },
  {
    id: 'aura', type: 'weapon', name: '墨潮', icon: '潮',
    desc: p => p.weapons.aura === 0
      ? '解锁墨潮光环，持续侵蚀身周之敌'
      : '光环范围与伤害提升（Lv' + p.weapons.aura + ' → ' + (p.weapons.aura + 1) + '）',
  },
  {
    id: 'frost', type: 'weapon', name: '冰棱', icon: '冰',
    desc: p => p.weapons.frost === 0
      ? '解锁冰棱环，周期爆发并大幅减速敌人'
      : '冰环伤害 / 频率提升（Lv' + p.weapons.frost + ' → ' + (p.weapons.frost + 1) + '）',
  },

  /* --- 属性强化 --- */
  {
    id: 'sharp', type: 'stat', name: '锋锐', icon: '锋', max: 5,
    desc: () => '全部伤害 +15%',
    apply: p => { p.stats.dmgMult += 0.15; },
  },
  {
    id: 'swift', type: 'stat', name: '疾风', icon: '风', max: 5,
    desc: () => '移动速度 +8%',
    apply: p => { p.stats.speedMult += 0.08; },
  },
  {
    id: 'vitality', type: 'stat', name: '生生', icon: '生', max: 5,
    desc: () => '生命上限 +25，并立即回复 25',
    apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); },
  },
  {
    id: 'magnet', type: 'stat', name: '聚灵', icon: '聚', max: 5,
    desc: () => '星火拾取范围 +30%',
    apply: p => { p.stats.pickupMult += 0.3; },
  },
  {
    id: 'focus', type: 'stat', name: '迅诀', icon: '诀', max: 5,
    desc: () => '武器攻击间隔 -10%',
    apply: p => { p.stats.cdMult *= 0.9; },
  },
  {
    id: 'regen', type: 'stat', name: '回春', icon: '春', max: 5,
    desc: () => '每秒自动回复 0.8 生命',
    apply: p => { p.stats.regen += 0.8; },
  },
  {
    id: 'starcore', type: 'stat', name: '星核', icon: '星', max: 5,
    desc: () => '星火经验获取 +12%',
    apply: p => { p.stats.xpMult += 0.12; },
  },
  {
    id: 'heal', type: 'stat', name: '急救', icon: '药', max: 0,
    desc: () => '立即回复 45% 生命',
    apply: p => { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.45); },
  },
];

/* ============ 武器进化卡池（武器满 5 级后出现，每种限一次） ============ */

const EVOLUTION_POOL = [
  {
    id: 'orbit', type: 'evolve', name: '焚墨环', icon: '焚',
    desc: () => '符火进化：周期喷发焚墨火环，命中附加灼烧（持续伤害）',
  },
  {
    id: 'bolt', type: 'evolve', name: '贯星阵', icon: '贯',
    desc: () => '飞星进化：星弹无限穿透，每第 5 发化为五星贯阵',
  },
  {
    id: 'thunder', type: 'evolve', name: '连霆', icon: '霆',
    desc: () => '雷印进化：落雷留下霆印，短暂延迟后二次爆轰',
  },
];
