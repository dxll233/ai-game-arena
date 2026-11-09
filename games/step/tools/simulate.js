#!/usr/bin/env node
/*
 * 《霓虹防线》第二轮 Node 无头仿真测试
 * 用法：node tools/simulate.js
 * 覆盖验收：A1(Boss公式) B1(三地图) B2(四塔互斥分支) B3(特殊敌人) B4(回归)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: index.html 中未找到 <script>'); process.exit(1); }
const code = m[1];

/* ---------- DOM / Canvas 桩 ---------- */
function mkGrad() { return { addColorStop() {} }; }
function mkCtx() {
  const grad = mkGrad();
  const noop = () => {};
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 0 });
      if (p === 'canvas') return { width: 960, height: 600 };
      return noop;
    },
    set() { return true; }
  });
}
function mkEl(tag) {
  const e = {
    tagName: tag, style: {}, dataset: {}, children: [], _h: {}, _attrs: {},
    textContent: '', innerHTML: '', disabled: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
    fire(t, ev) { (this._h[t] || []).forEach(f => f(ev || {})); },
    appendChild(c) { this.children.push(c); return c; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    querySelectorAll() { return []; }
  };
  if (tag === 'canvas') { e.width = 220; e.height = 120; e.getContext = () => mkCtx(); }
  return e;
}
const els = {};
const documentStub = {
  getElementById(id) {
    if (!els[id]) els[id] = mkEl(id === 'game' ? 'canvas' : 'div');
    return els[id];
  },
  createElement(t) { return mkEl(t); },
  querySelectorAll() { return []; },
  addEventListener() {},
  hidden: false,
  body: mkEl('body')
};
const store = {};
const localStorageStub = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};
const windowStub = { addEventListener() {}, AudioContext: undefined, webkitAudioContext: undefined, devicePixelRatio: 1, localStorage: localStorageStub };
const sandbox = {
  window: windowStub,
  document: documentStub,
  localStorage: localStorageStub,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'game.js' });
} catch (err) {
  console.error('FAIL: 游戏脚本加载/语法错误');
  console.error(err.stack);
  process.exit(1);
}
const ND = windowStub.__ND;
if (!ND) { console.error('FAIL: 未导出调试接口 window.__ND'); process.exit(1); }
const G = ND.G, TOWERS = ND.TOWERS, ETYPES = ND.ETYPES, WAVES = ND.WAVES, MAPS = ND.MAPS, api = ND.api;
console.log('PASS: 脚本加载成功（地图 ' + MAPS.length + ' 张 / 塔 ' + Object.keys(TOWERS).length +
  ' 种 / 敌人 ' + Object.keys(ETYPES).length + ' 类 / 波次 ' + WAVES.length + '）');

let passCount = 0, failCount = 0;
function ok(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; console.log('FAIL: ' + label); }
  return cond;
}
function run(frames, dt) {
  dt = dt || 1 / 30;
  for (var i = 0; i < frames; i++) api.update(dt);
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }
/* 开新局（测试辅助：显式指定地图，避免 startGame 使用残留 mapIdx） */
function newGame(mapIdx) { G.mapIdx = mapIdx || 0; api.startGame(); }
/* 找离指定点最近的可建造格（用于把塔建到被测敌人旁边） */
function spotNear(x, y, maxD) {
  let best = null, bd = 1e9;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 24; c++) {
    if (!api.canBuildAt(c, r)) continue;
    const cx = c * 40 + 20, cy = r * 40 + 20;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bd) { bd = d; best = { c, r, d }; }
  }
  return best && best.d <= maxD ? best : null;
}

/* ================= A1：Boss 数量与生命公式 ================= */
console.log('\n---- A1 Boss 公式统一 ----');
ok(WAVES.length === 20, '波次表长度仍为 20');
const bossWaves = WAVES.map((wv, i) => wv.g.some(g => g[0] === 'boss') ? i + 1 : 0).filter(Boolean);
ok(JSON.stringify(bossWaves) === JSON.stringify([5, 10, 15, 20]), 'Boss 固定位于 5/10/15/20 波，实际: ' + bossWaves.join(','));
const bossCount20 = WAVES[19].g.filter(g => g[0] === 'boss').reduce((s, g) => s + g[1], 0);
ok(bossCount20 === 1, '第20波 Boss 数量为 1（单Boss基线，与实现一致）');
/* 公式: HP = 880 × (1+0.15(w-1)) × 1.35^(⌊w/5⌋-1) × (w≥20?1.7:1) × 地图hpMul */
const HP_TABLE = { 5: 1408, 10: 2791.8, 15: 4971.78, 20: 14170.77585 };
for (const w of [5, 10, 15, 20]) {
  api.startGame(); G.wave = w;
  const b = api.spawnEnemy('boss');
  const expect = api.bossHpAt(w, 1);
  ok(approx(b.hp, expect) && approx(expect, HP_TABLE[w], 0.01),
    'w=' + w + ' BossHP 运行时=' + b.hp.toFixed(4) + ' 公式=' + expect.toFixed(4) + ' 文档表=' + HP_TABLE[w]);
}
/* 波次表所有类型必须在敌表中（保证波次预览不缺失） */
let allTypesKnown = true;
for (const wv of WAVES) for (const g of wv.g) if (!ETYPES[g[0]]) allTypesKnown = false;
ok(allTypesKnown, '波次表所有敌人类型均在 ETYPES 中（预览完整）');

/* ================= B1：三张地图 ================= */
console.log('\n---- B1 地图系统 ----');
ok(MAPS.length === 3, '地图总数为 3');
const lens = MAPS.map(api.mapPathLen), cores = MAPS.map(m2 => m2.core.x + ',' + m2.core.y);
ok(new Set(lens).size === 3, '三张地图路径长度互不相同: ' + lens.join(' / '));
ok(new Set(cores).size === 3, '三张地图核心位置互不相同: ' + cores.join(' / '));
/* 从路径点实算拐点数（方向变化次数），与地图配置 turns 字段比对 */
function actualTurns(m) {
  let t = 0;
  for (let i = 1; i < m.pts.length - 1; i++) {
    const a = m.pts[i - 1], b = m.pts[i], c = m.pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1) t++;
  }
  return t;
}
ok(MAPS.every(m => actualTurns(m) === m.turns),
  '三张地图 turns 字段与实际拐点数一致: ' + MAPS.map(m => m.name + '=' + m.turns).join(' / '));
ok(new Set(MAPS.map(actualTurns)).size === 3,
  '三张地图实际拐点数互不相同: ' + MAPS.map(actualTurns).join(' / '));
ok(MAPS[0].pts[0][0] < 0 && MAPS[2].pts[0][0] > 900, '地图1/2 敌人从左侧进入，地图3 从右侧进入（逆向流）');
for (let i = 0; i < MAPS.length; i++) {
  G.mapIdx = i;
  api.setMap(i);
  api.startGame();
  const mp = MAPS[i];
  const p0 = api.posAt(0), p1 = api.posAt(api.getPathLen());
  ok(approx(p1.x, mp.core.x, 2) && approx(p1.y, mp.core.y, 2),
    '地图' + (i + 1) + '《' + mp.name + '》敌人终点=核心 (' + p1.x.toFixed(0) + ',' + p1.y.toFixed(0) + ')');
  ok(approx(p0.x, mp.pts[0][0], 2) && approx(p0.y, mp.pts[0][1], 2),
    '地图' + (i + 1) + ' 路径起点与配置一致');
  /* 建造判定：路径附近必有不可建格，也必有可建格 */
  let blocked = 0, free = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 24; c++) {
    if (api.canBuildAt(c, r)) free++; else blocked++;
  }
  ok(blocked > 20 && free > 100, '地图' + (i + 1) + ' 建造判定: 不可建 ' + blocked + ' 格 / 可建 ' + free + ' 格');
  ok(G.towers.length === 0 && G.enemies.length === 0, '地图' + (i + 1) + ' 新局状态已重置');
}
/* 切换地图不继承旧状态 */
newGame(0); G.money = 9999;
var s0 = api.goodSpots()[0];
api.tryBuild('mg', s0.c, s0.r);
ok(api.towerAt(s0.c, s0.r) !== null, '地图1 建塔成功');
G.mapIdx = 2; api.startGame();
ok(G.towers.length === 0, '切换到地图3 后塔不继承');
ok(approx(ND.CORE.x, MAPS[2].core.x) && approx(ND.CORE.y, MAPS[2].core.y), '切换后核心位置跟随地图3');

/* ================= B2：四塔互斥分支 ================= */
console.log('\n---- B2 互斥进阶分支 ----');
const BRANCH_PICK = { mg: 'a', frost: 'b', laser: 'a', splash: 'a' };
for (const type of ['mg', 'frost', 'laser', 'splash']) {
  newGame(0); G.money = 9999;
  const sp = api.goodSpots()[0];
  api.tryBuild(type, sp.c, sp.r);
  const t = api.towerAt(sp.c, sp.r);
  api.upgradeTower(t); api.upgradeTower(t);
  ok(t.level === 2 && !t.branch, TOWERS[type].name + ' 升至 Lv.2 且未选分支');
  const pick = BRANCH_PICK[type], other = pick === 'a' ? 'b' : 'a';
  ok(api.chooseBranch(t, pick) === true, TOWERS[type].name + ' 可选择分支 ' + pick.toUpperCase() +
    '（' + TOWERS[type].branches[pick].name + ' $' + TOWERS[type].branches[pick].cost + '）');
  ok(api.chooseBranch(t, other) === false && t.branch === pick,
    TOWERS[type].name + ' 分支互斥：另一支 ' + other.toUpperCase() + ' 不可购买');
  const st = api.towerStats(t);
  ok(st && (st.dmg || st.dps), TOWERS[type].name + ' 分支属性已生效: ' +
    (st.dps ? 'DPS' + st.dps : '伤害' + st.dmg) + ' 射程' + st.range);
  /* 资金不足时不可选分支 */
  newGame(0); G.money = 9999;
  const sp2 = api.goodSpots()[1];
  api.tryBuild(type, sp2.c, sp2.r);
  const t2 = api.towerAt(sp2.c, sp2.r);
  api.upgradeTower(t2); api.upgradeTower(t2);
  G.money = 1;
  ok(api.chooseBranch(t2, 'a') === false && !t2.branch, TOWERS[type].name + ' 资金不足时无法选择分支');
  /* 出售按实际投入返还60% */
  G.money = 9999;
  const invested = t2.invested;
  const before = G.money;
  api.sellTower(t2);
  ok(G.money === before + Math.floor(invested * 0.6), TOWERS[type].name + ' 出售返还 = 投入$' + invested + '×60% = $' + Math.floor(invested * 0.6));
}
/* 分支行为差异：机枪穿甲 vs 散射 */
newGame(0); G.money = 9999;
{
  const sp = api.goodSpots()[0];
  api.tryBuild('mg', sp.c, sp.r);
  const ta = api.towerAt(sp.c, sp.r);
  api.upgradeTower(ta); api.upgradeTower(ta); api.chooseBranch(ta, 'a');
  const sta = api.towerStats(ta);
  G.wave = 8;
  const brute = api.spawnEnemy('brute', 300);
  brute.hp = brute.maxHp = 1000;
  api.damage(brute, sta.dmg, sta.pierce, ta);   /* 穿甲: 26-0 */
  const dmgA = 1000 - brute.hp;
  const sp2 = api.goodSpots()[1];
  api.tryBuild('mg', sp2.c, sp2.r);
  const tb = api.towerAt(sp2.c, sp2.r);
  api.upgradeTower(tb); api.upgradeTower(tb); /* 未选分支 Lv2 */
  const brute2 = api.spawnEnemy('brute', 300);
  brute2.hp = brute2.maxHp = 1000;
  api.damage(brute2, TOWERS.mg.levels[1].dmg, 0, tb); /* 无穿甲: max(1,15-4)=11 */
  const dmgNoPierce = 1000 - brute2.hp;
  ok(dmgA === 26 && dmgNoPierce === 11, '穿甲弹对重甲 26 伤害 vs 无穿甲 11 伤害（护甲4生效）');
}
/* 散射弹同时打3目标，单管只打1目标（短跑：避免领头敌跑出 Lv2 射程128） */
{
  newGame(0); G.money = 9999; G.wave = 8;
  const e1 = api.spawnEnemy('runner', 300), e2 = api.spawnEnemy('runner', 260), e3 = api.spawnEnemy('runner', 220);
  e1.hp = e1.maxHp = 5000; e2.hp = e2.maxHp = 5000; e3.hp = e3.maxHp = 5000;
  const pm = api.posAt(260);
  const spm = spotNear(pm.x, pm.y, 100);
  api.tryBuild('mg', spm.c, spm.r);
  const tb = api.towerAt(spm.c, spm.r);
  api.upgradeTower(tb); api.upgradeTower(tb); api.chooseBranch(tb, 'b');
  run(10); /* 塔第1帧即开火（cd=0），0.33秒内仅1发，3目标应同时掉血 */
  ok(e1.hp < 5000 && e2.hp < 5000 && e3.hp < 5000, '散射弹同时命中3个目标');
  newGame(0); G.money = 9999; G.wave = 8;
  const f1 = api.spawnEnemy('runner', 300), f2 = api.spawnEnemy('runner', 260), f3 = api.spawnEnemy('runner', 220);
  f1.hp = f1.maxHp = 5000; f2.hp = f2.maxHp = 5000; f3.hp = f3.maxHp = 5000;
  const spm2 = spotNear(pm.x, pm.y, 100);
  api.tryBuild('mg', spm2.c, spm2.r);
  const tc = api.towerAt(spm2.c, spm2.r);
  api.upgradeTower(tc); api.upgradeTower(tc); /* Lv2 单体 */
  run(10);
  ok(f1.hp < 5000 && f2.hp === 5000 && f3.hp === 5000, '未选分支时仅命中最靠前1个目标');
}
/* 激光分束打多目标、聚焦射程更远 */
{
  newGame(0); G.money = 9999; G.wave = 8;
  const g1 = api.spawnEnemy('runner', 300), g2 = api.spawnEnemy('runner', 280);
  g1.hp = g1.maxHp = 5000; g2.hp = g2.maxHp = 5000;
  const pl = api.posAt(290);
  const spl = spotNear(pl.x, pl.y, 130);
  api.tryBuild('laser', spl.c, spl.r);
  const tl = api.towerAt(spl.c, spl.r);
  api.upgradeTower(tl); api.upgradeTower(tl);
  api.chooseBranch(tl, 'b');
  const stb = api.towerStats(tl);
  ok(stb.range === 148 && stb.multi === 3 && stb.dps === 44, '分束: 射程148 / 3目标 / DPS44');
  run(40);
  ok(g1.hp < 5000 && g2.hp < 5000, '分束同时照射2个目标');
  newGame(0); G.money = 9999;
  const spl2 = spotNear(pl.x, pl.y, 130);
  api.tryBuild('laser', spl2.c, spl2.r);
  const tl2 = api.towerAt(spl2.c, spl2.r);
  api.upgradeTower(tl2); api.upgradeTower(tl2);
  api.chooseBranch(tl2, 'a');
  const sta = api.towerStats(tl2);
  ok(sta.range === 180 && sta.dps === 98 && !sta.multi, '聚焦: 射程180 / DPS98 / 单体');
}
/* 溅射破片半径大于攻城弹 */
{
  newGame(0); G.money = 9999;
  const sp = api.goodSpots()[0];
  api.tryBuild('splash', sp.c, sp.r);
  const t1 = api.towerAt(sp.c, sp.r);
  api.upgradeTower(t1); api.upgradeTower(t1); api.chooseBranch(t1, 'a');
  const sp2 = api.goodSpots()[1];
  api.tryBuild('splash', sp2.c, sp2.r);
  const t2 = api.towerAt(sp2.c, sp2.r);
  api.upgradeTower(t2); api.upgradeTower(t2); api.chooseBranch(t2, 'b');
  const s1 = api.towerStats(t1), s2 = api.towerStats(t2);
  ok(s1.sr === 87 && s1.dmg === 67, '破片: 半径87 / 伤害67（+55%半径, -25%伤害）');
  ok(s2.sr === 31 && s2.dmg === 162, '攻城弹: 半径31 / 伤害162（×1.8重击, -45%半径）');
  ok(s1.sr > TOWERS.splash.levels[1].sr && s2.sr < TOWERS.splash.levels[1].sr, '两分支半径分居 Lv2 基准(56)两侧');
}
/* 冰霜深寒减速更强，霜爆有范围伤害 */
{
  newGame(0); G.money = 9999; G.wave = 8;
  const r1 = api.spawnEnemy('runner', 300);
  r1.hp = r1.maxHp = 5000;
  const pf = api.posAt(300);
  const spf = spotNear(pf.x, pf.y, 100);
  api.tryBuild('frost', spf.c, spf.r);
  const tf = api.towerAt(spf.c, spf.r);
  api.upgradeTower(tf); api.upgradeTower(tf); api.chooseBranch(tf, 'a');
  const sfa = api.towerStats(tf);
  ok(sfa.slow === 0.34 && sfa.sd === 2.6, '深寒: 减速66% / 持续2.6s');
  run(40);
  ok(r1.slowT > 0 && approx(r1.slowF, 0.34, 0.001), '深寒减速数值实际生效 slowF=' + r1.slowF);
  newGame(0); G.money = 9999; G.wave = 8;
  const q1 = api.spawnEnemy('runner', 300), q2 = api.spawnEnemy('runner', 260);
  q1.hp = q1.maxHp = 5000; q2.hp = q2.maxHp = 5000;
  const pq = api.posAt(280);
  const spq = spotNear(pq.x, pq.y, 70);
  api.tryBuild('frost', spq.c, spq.r);
  const tf2 = api.towerAt(spq.c, spq.r);
  api.upgradeTower(tf2); api.upgradeTower(tf2); api.chooseBranch(tf2, 'b');
  const sfb = api.towerStats(tf2);
  ok(sfb.pulse && sfb.pulse.sr === 80 && sfb.pulse.dmg === 26, '霜爆: 每3秒半径80伤害26');
  tf2.pulseCd = 0.05; /* 白盒：立即触发一次霜爆周期 */
  run(10);
  ok(q1.hp < 5000 && q2.hp < 5000, '霜爆对范围内多个敌人造成伤害（含非首选目标）');
}
/* 重开/切图后分支状态重置 */
newGame(0); G.money = 9999;
{
  const sp = api.goodSpots()[0];
  api.tryBuild('mg', sp.c, sp.r);
  const t = api.towerAt(sp.c, sp.r);
  api.upgradeTower(t); api.upgradeTower(t); api.chooseBranch(t, 'a');
  api.startGame();
  ok(G.towers.length === 0, '重开新局后分支状态重置（塔清空）');
  G.mapIdx = 1; api.startGame();
  ok(G.towers.length === 0, '切换地图开新局后分支状态重置');
}
/* 悬停 Lv.2/Lv.3 塔的射程预览不得报错（回归：levels[2] 越界，第二轮浏览器实测发现） */
newGame(0); G.money = 9999;
{
  const sp = api.goodSpots()[0];
  api.tryBuild('mg', sp.c, sp.r);
  const t = api.towerAt(sp.c, sp.r);
  api.upgradeTower(t); api.upgradeTower(t);
  G.hover = { c: sp.c, r: sp.r };
  let err1 = null;
  try { api.render(); } catch (e) { err1 = e; }
  ok(!err1, '悬停 Lv.2（未选分支）塔渲染射程预览不报错' + (err1 ? '：' + err1.message : ''));
  api.chooseBranch(t, 'a');
  let err2 = null;
  try { api.render(); } catch (e) { err2 = e; }
  ok(!err2, '悬停 Lv.3（已选分支）塔渲染射程预览不报错' + (err2 ? '：' + err2.message : ''));
  G.hover = null;
}

/* ================= B3：特殊敌人 ================= */
console.log('\n---- B3 特殊敌人 ----');
/* 首见波次：shieldnode 第6波、charger 第8波（波次表契约） */
function firstWaveOf(type) {
  for (let i = 0; i < WAVES.length; i++) if (WAVES[i].g.some(g => g[0] === type)) return i + 1;
  return 0;
}
ok(firstWaveOf('shieldnode') === 6, '护盾节点首见于第6波（实际第' + firstWaveOf('shieldnode') + '波）');
ok(firstWaveOf('charger') === 8, '冲锋体首见于第8波（实际第' + firstWaveOf('charger') + '波）');
/* --- 护盾节点 --- */
newGame(0); G.wave = 8;
{
  const sn = api.spawnEnemy('shieldnode', 200);
  const r1 = api.spawnEnemy('runner', 240);   /* 40px内，应获护盾 */
  const r2 = api.spawnEnemy('runner', 900);   /* 远，不应获护盾 */
  const fl = api.spawnEnemy('flyer', 240);    /* 空中单位，不应获护盾 */
  r1.hp = r1.maxHp = 1000; r2.hp = r2.maxHp = 1000; fl.hp = fl.maxHp = 1000;
  run(90); /* 3秒，覆盖1.2秒后首次施法 */
  ok(r1.shieldT > 0, '护盾节点为附近单位附加护盾（shieldT=' + r1.shieldT.toFixed(2) + '）');
  ok(r2.shieldT === 0, '射程外单位不受护盾');
  ok(fl.shieldT === 0, '空中单位（浮空体）不受护盾（不适用案例）');
  const hp0 = r1.hp; api.damage(r1, 50, 0, null);
  ok(approx(r1.hp, hp0 - 25, 0.001), '护盾使伤害减半: 50→25（实际' + (hp0 - r1.hp) + '）');
  const hp1 = r2.hp; api.damage(r2, 50, 0, null);
  ok(approx(r2.hp, hp1 - 50, 0.001), '无护盾单位承受全额伤害');
  const hp2 = r1.hp; api.damage(r1, 50, 999, null);
  ok(approx(r1.hp, hp2 - 25, 0.001), '激光穿透护甲但不穿透护盾（仍减半）');
  /* EMP 眩晕期间无法施法 */
  newGame(0); G.wave = 8;
  const sn2 = api.spawnEnemy('shieldnode', 200);
  const r3 = api.spawnEnemy('runner', 240);
  r3.hp = r3.maxHp = 1000;
  run(60); /* 等首次护盾结束 */
  r3.shieldT = 0; sn2.castCd = 0.1;
  api.emp();
  run(15); /* 0.5秒眩晕中 */
  ok(sn2.stunT > 0 && sn2.castCd === 0.1, 'EMP眩晕期间护盾节点无法施法（castCd冻结）');
  run(80); /* 眩晕结束后恢复 */
  ok(r3.shieldT > 0, '眩晕结束后恢复施法');
  /* 击杀护盾节点后已有护盾按各自持续时间自然消退 */
  const sn3 = api.spawnEnemy('shieldnode', 400);
  const r4 = api.spawnEnemy('runner', 430);
  r4.hp = r4.maxHp = 1000;
  run(90);
  ok(r4.shieldT > 0, '新护盾节点可再次施法');
  api.damage(sn3, 1e6, true, null);
  ok(sn3.dead === true, '护盾节点可被击杀');
  run(120); /* 4秒后护盾自然消退 */
  ok(r4.shieldT <= 0, '护盾节点死后护盾在持续时间内自然消退（无永久护盾）');
}
/* --- 冲锋体 --- */
newGame(0); G.wave = 8;
{
  const ch = api.spawnEnemy('charger', 100);
  ch.hp = ch.maxHp = 5000;
  let guard = 0;
  while (ch.chargePhase !== 'windup' && guard++ < 300) run(1);
  ok(ch.chargePhase === 'windup', '冲锋体进入蓄力预警状态');
  run(35); /* 1.17秒 → 进入冲锋 */
  ok(ch.chargePhase === 'dash', '蓄力后进入高速冲锋（速度×3.2）');
  /* 在冲锋路径旁建塔，验证撞塔停火（取距冲锋体最近的可建格，保证在其行进前方） */
  const p = api.posAt(ch.dist);
  let placed = null, bd = 1e9;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 24; c++) {
    const cx = c * 40 + 20, cy = r * 40 + 20;
    if (!api.canBuildAt(c, r)) continue;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d < bd) { bd = d; placed = { c, r }; }
  }
  G.money = 9999;
  ok(placed && api.tryBuild('mg', placed.c, placed.r), '在冲锋路径旁建造机枪塔');
  const tw = placed ? api.towerAt(placed.c, placed.r) : null;
  guard = 0;
  while (tw && tw.stunT <= 0 && guard++ < 200) run(1);
  ok(tw && tw.stunT > 0, '冲锋体撞击防御塔造成停火（stunT=' + (tw ? tw.stunT.toFixed(2) : 0) + '）');
  /* 停火期间不开火：放入射程内敌人验证不掉血 */
  const victim = api.spawnEnemy('runner', 300);
  victim.hp = victim.maxHp = 5000;
  const vhp = victim.hp;
  run(20);
  ok(tw.stunT > 0 && victim.hp === vhp, '停火期间防御塔无法攻击');
  /* 不适用案例：过载不能解除冲锋造成的停火 */
  api.overdrive(tw);
  ok(tw.stunT > 0 && tw.odT > 0, '过载无法解除冲锋停火（仅冷却走完才恢复）');
  /* 冲锋可被EMP中断回行走 */
  const ch2 = api.spawnEnemy('charger', 500);
  guard = 0;
  while (ch2.chargePhase !== 'windup' && guard++ < 300) run(1);
  api.emp();
  run(2);
  ok(ch2.chargePhase === 'walk' && ch2.stunT > 0, 'EMP可中断冲锋并重置状态');
  /* 冰霜减速对冲锋体有效（不免疫） */
  newGame(0); G.money = 9999; G.wave = 8;
  const ch3 = api.spawnEnemy('charger', 200);
  const pp = api.posAt(ch3.dist + 40);
  let fspot = null, fbd = 1e9;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 24; c++) {
    const cx = c * 40 + 20, cy = r * 40 + 20;
    if (!api.canBuildAt(c, r)) continue;
    const d = Math.hypot(cx - pp.x, cy - pp.y);
    if (d < fbd) { fbd = d; fspot = { c, r }; }
  }
  api.tryBuild('frost', fspot.c, fspot.r);
  guard = 0;
  while (ch3.slowT <= 0 && guard++ < 200) run(1);
  ok(ch3.slowT > 0, '冰霜减速对冲锋体生效（slowT=' + ch3.slowT.toFixed(2) + '）');
  /* 控制时长有界，无无限控制 */
  let maxStun = 0;
  for (const e of G.enemies) maxStun = Math.max(maxStun, e.stunT || 0);
  ok(maxStun <= 2.5 + 1e-9, '敌人眩晕时长有界（≤EMP 2.5秒，无无限控制）');
}

/* ================= B4：回归 ================= */
console.log('\n---- B4 回归 ----');
newGame(0); G.money = 9999;
{
  const sp = api.goodSpots()[0];
  api.tryBuild('mg', sp.c, sp.r);
  const t = api.towerAt(sp.c, sp.r);
  api.overdrive(t);
  ok(t.odT > 5.9 && t.odCd === 20, '过载数值与冷却不变（6秒/CD20）');
  api.emp();
  ok(G.empCd === 45, 'EMP冷却不变（45秒）');
  run(60);
  ok(G.empCd < 45, 'EMP冷却随时间递减');
  api.togglePause();
  ok(G.phase === 'paused', '暂停正常');
  api.togglePause();
  ok(G.phase === 'playing', '恢复正常');
  api.earlyCall();
  ok(G.wave === 1 && G.waveActive, '提前开波正常');
}
/* 路径检查（地图1） */
{
  const a = api.posAt(0), b = api.posAt(api.getPathLen());
  ok(approx(a.x, -40) && approx(b.x, 880) && approx(b.y, 500), '地图1 路径起点/终点正确');
}
/* BOSS分裂回归 */
newGame(0); G.wave = 5;
{
  const boss = api.spawnEnemy('boss');
  const before = G.enemies.filter(e => e.t === 'runner').length;
  api.damage(boss, 1e6, true, null);
  const after = G.enemies.filter(e => e.t === 'runner').length;
  ok(after - before === 6, 'BOSS死亡分裂6只迅捷体（回归）');
}

/* ================= 机器人通关仿真（三地图） ================= */
console.log('\n---- B4 机器人仿真（非人工通关证据，仅回归与平衡参考） ----');
let spots = [];   /* 当前地图推荐建塔点（botAct 读取，随地图重建） */
/* 机器人策略（模拟一名普通玩家，只用界面可用操作）：
 * 1) EMP：Boss 在场或场上敌人≥8 时释放；
 * 2) 过载：波次中给击杀数最高的塔（CD 好即可用）；
 * 3) 分支优先：Lv.2 塔立即互斥进阶（最大战力跃升，按 BR_PICK 固定选择）；
 * 4) 升级：把现有塔依次推到 Lv.2；
 * 5) 扩建：塔数未达 5+⌊波次×0.45⌋ 时按类型缺口补塔。
 * 记录：每张地图以剩余生命通关 20 波视为平衡达标。 */
function chooseType() {
  const counts = { mg: 0, frost: 0, laser: 0, splash: 0 };
  G.towers.forEach(t => counts[t.type]++);
  const total = G.towers.length || 1;
  const nextW = WAVES[Math.min(20, G.wave + 1) - 1];
  const armored = nextW && nextW.g.some(g => g[0] === 'brute' || g[0] === 'boss');
  const want = armored
    ? { mg: 0.40, frost: 0.18, laser: 0.20, splash: 0.22 }
    : { mg: 0.44, frost: 0.20, laser: 0.14, splash: 0.22 };
  let best = null, bd = -1;
  for (const k of ['mg', 'frost', 'laser', 'splash']) {
    const d = want[k] - counts[k] / total;
    if (d > bd && G.money >= TOWERS[k].cost) { bd = d; best = k; }
  }
  return best;
}
const BR_PICK = { mg: 'a', frost: 'b', laser: 'a', splash: 'a' };
function botAct() {
  const bossOn = G.enemies.some(e => e.t === 'boss');
  if (G.empCd <= 0 && (bossOn || G.enemies.length >= 8)) api.emp();
  if (G.waveActive && (bossOn || G.enemies.length >= 5)) {
    const t = G.towers.filter(t => t.odCd <= 0).sort((a, b) => b.kills - a.kills)[0];
    if (t) api.overdrive(t);
  }
  /* 分支优先：Lv.2 塔立即进阶（最大战力跃升） */
  const bs = G.towers.filter(t => t.level === 2 && !t.branch).sort((a, b) => b.kills - a.kills);
  for (const t of bs) {
    const cost = TOWERS[t.type].branches[BR_PICK[t.type]].cost;
    if (G.money >= cost) { api.chooseBranch(t, BR_PICK[t.type]); return; }
  }
  /* 升级：把现有塔推到 Lv2 */
  const cands = G.towers.filter(t => t.level < 2).sort((a, b) => a.level - b.level || b.kills - a.kills);
  for (const t of cands) {
    const up = TOWERS[t.type].levels[t.level].up;
    if (G.money >= up) { api.upgradeTower(t); return; }
  }
  /* 扩建：塔数不足目标时补充 */
  const free = spots.filter(s => !api.towerAt(s.c, s.r));
  const target = Math.min(spots.length, 5 + Math.floor(G.wave * 0.45));
  if (free.length > 0 && G.towers.length < target) {
    for (const s of free) {
      const type = chooseType();
      if (type && api.tryBuild(type, s.c, s.r)) return;
    }
  }
}
for (let mi = 0; mi < MAPS.length; mi++) {
  G.mapIdx = mi; api.setMap(mi); api.startGame();
  spots = api.goodSpots();   /* 建塔点随地图重建（路径不同，推荐点不同） */
  console.log('  [' + MAPS[mi].name + '] 推荐建塔点 ' + spots.length + ' 个');
  let iter = 0, lastAct = -1, peak = 0;
  while (iter++ < 2000000 && G.phase === 'playing') {
    peak = Math.max(peak, G.enemies.length);
    if (G.time - lastAct > 0.4) { botAct(); lastAct = G.time; }
    api.update(1 / 30);
  }
  console.log('  [' + MAPS[mi].name + '] phase=' + G.phase + ' wave=' + G.wave + ' lives=' + G.lives +
    ' towers=' + G.towers.length + ' peakEnemies=' + peak);
  ok(G.phase === 'victory', '机器人在《' + MAPS[mi].name + '》通关20波（剩余生命 ' + G.lives + '）');
}
/* 空闲必败 */
G.mapIdx = 0; api.startGame();
let it2 = 0;
while (it2++ < 2000000 && G.phase === 'playing') api.update(1 / 30);
ok(G.phase === 'gameover' && G.lives === 0, '无塔策略仍然失败（败于第 ' + G.wave + ' 波，生命归零）');

/* ================= API 冒烟 ================= */
console.log('\n---- API 冒烟 ----');
newGame(0);
spots = api.goodSpots();   /* 回到地图1后重建推荐点 */
try {
  if (api.tryBuild('mg', 5, 2) !== false) ok(false, '路径上应不可建造'); else ok(true, '路径上不可建造');
  const s0 = spots[0];
  if (api.tryBuild('mg', s0.c, s0.r) !== true) ok(false, '合法位置建塔失败'); else ok(true, '合法位置建塔成功');
  const t = api.towerAt(s0.c, s0.r);
  const moneyBefore = G.money;
  api.upgradeTower(t);
  ok(t.level === 1 && G.money < moneyBefore, '升级正常');
  api.overdrive(t);
  ok(t.odT > 0, '过载正常');
  api.emp();
  ok(G.empCd > 0, 'EMP正常');
  api.togglePause(); api.togglePause();
  api.earlyCall();
  ok(G.waveActive && G.wave === 1, '提前开波正常');
  api.sellTower(t);
  ok(G.towers.length === 0 && !G.selected, '出售正常');
  const boss = api.spawnEnemy('boss');
  const rb = G.enemies.filter(e => e.t === 'runner').length;
  api.damage(boss, 1e6, true, null);
  ok(G.enemies.filter(e => e.t === 'runner').length - rb === 6, 'BOSS分裂正常');
  api.render();
  ok(true, '渲染冒烟通过');
  api.gameOver();
  ok(G.phase === 'gameover', 'gameOver正常');
  api.startGame();
  api.victory();
  ok(G.phase === 'victory', 'victory正常');
} catch (err) {
  ok(false, 'API 冒烟测试异常: ' + err.message);
}

/* ================= C1：敌军情报系统（v3 核心升级） ================= */
console.log('\n---- C1 敌军情报（v3 核心升级） ----');
{
  /* 威胁评级：随波次递增且限制在 1-5 星 */
  const t1 = ND.waveThreat(1), t10 = ND.waveThreat(10), t20 = ND.waveThreat(20);
  ok(t1 < t10 && t10 < t20, '威胁评级随波次递增: w1=' + t1.toFixed(0) + ' < w10=' + t10.toFixed(0) + ' < w20=' + t20.toFixed(0));
  let starsOk = true;
  for (let w = 1; w <= 20; w++) if (ND.threatStars(w) < 1 || ND.threatStars(w) > 5) starsOk = false;
  ok(starsOk, '威胁星级全部在 1-5 之间');
  ok(ND.threatStars(1) === 1 && ND.threatStars(20) === 5, '首波 1 星、终局 5 星');

  /* 情报 chips 与波次表逐项一致（敌人名+数量+标签） */
  const c20 = (function () {
    let out = '';
    for (const g of WAVES[19].g) out += ETYPES[g[0]].name + 'x' + g[1];
    return out;
  })();
  const chips20 = ND.waveChips ? null : null; /* waveChips 未导出，用 renderIntel 输出验证 */
  ok(WAVES[19].g.length === 5 && WAVES[19].g[0][0] === 'boss' && WAVES[19].g[0][1] === 1,
    '第20波 = BOSS x1 + 4 类杂兵（波次表口径）');

  /* 特性标签 */
  ok(ND.enemyTags('brute').includes('重甲4'), '重甲体带"重甲4"标签');
  ok(ND.enemyTags('flyer').includes('飞行'), '浮空体带"飞行"标签');
  ok(ND.enemyTags('charger').includes('冲锋'), '冲锋体带"冲锋"标签');
  ok(ND.enemyTags('shieldnode').includes('护盾'), '护盾节点带"护盾"标签');
  ok(ND.enemyTags('boss').includes('BOSS'), 'BOSS 带"BOSS"标签');
  ok(ND.enemyTags('runner') === '', '迅捷体无特殊标签');

  /* 图鉴完整性：6 种敌人全部有特性与反制建议 */
  let codexOk = true;
  for (const k in ETYPES) if (!ND.CODEX[k] || !ND.CODEX[k].tip || !ND.codexFeat(k)) codexOk = false;
  ok(Object.keys(ETYPES).length === 6 && codexOk, '图鉴覆盖全部 6 种敌人且均有反制建议');

  /* 情报面板渲染：进行中/准备期均显示 3 波 */
  newGame(0);
  ND.renderIntel();
  const intelHtml = documentStub.getElementById('intelPanel').innerHTML;
  ok(intelHtml.includes('第 1 波') && intelHtml.includes('第 2 波') && intelHtml.includes('第 3 波'),
    '准备期情报面板显示未来 3 波');
  ok(intelHtml.includes('迅捷体') && intelHtml.includes('×6'), '情报 chips 含敌人名称与数量');
  G.wave = 6; G.waveActive = null;
  ND.renderIntel();
  const intelHtml2 = documentStub.getElementById('intelPanel').innerHTML;
  ok(intelHtml2.includes('第 7 波') && intelHtml2.includes('重甲体'), '波 6 后情报显示第 7 起重甲波');

  /* 时间线与图鉴渲染 */
  ND.renderTimeline();
  const tlHtml = documentStub.getElementById('tlGrid').innerHTML;
  ok((tlHtml.match(/tl-num/g) || []).length === 20, '波次时间线渲染全部 20 波');
  ok((tlHtml.match(/tl-row boss/g) || []).length === 4, '时间线标注 4 个 BOSS 波次（5/10/15/20）');
  ND.renderCodex();
  const cxHtml = documentStub.getElementById('codexGrid').innerHTML;
  ok((cxHtml.match(/codex-card/g) || []).length === 6 && cxHtml.includes('反制'), '图鉴渲染 6 张敌人卡含反制建议');

  /* 首遇提示 + 分阶段引导 */
  newGame(0);
  ok(G.seen && Object.keys(G.seen).length === 0, '新局首遇记录已重置');
  api.spawnEnemy('shieldnode', 100);
  ok(G.seen.shieldnode === 1, '护盾节点首次登场被记录');
  const toastHtml = documentStub.getElementById('toast').innerHTML;
  ok(toastHtml.includes('护盾节点') && toastHtml.includes('减伤'), '首遇 Toast 解释护盾节点机制');
  for (let i = 0; i < 6; i++) { api.startWave(); G.waveActive = null; }   /* 逐波手动推进（清 waveActive 以连续调用） */
  const toast6 = documentStub.getElementById('toast').innerHTML;
  ok(toast6.includes('第 6 波') && toast6.includes('护盾'), '第 6 波分阶段引导提示出现');
}

/* ================= C2：存档系统（A6） ================= */
console.log('\n---- C2 存档系统（版本/校验/迁移/容错） ----');
function resetSave() {
  for (const k in store) delete store[k];
  ND.Save.data = ND.Save.defaults();
  ND.Save.notice = '';
}
function writeSaveRaw(json) { sandbox.localStorage.setItem('nd_save_v3', json); }
{
  /* 默认值 */
  resetSave();
  ok(ND.Save.data.unlock.zigzag === true && ND.Save.data.unlock.loop === false && ND.Save.data.unlock.serpent === false,
    '默认仅解锁 Z 字通道');
  ok(ND.Save.data.set.vol === 0.7 && ND.Save.data.set.muted === false, '默认音量 70%、未静音');

  /* 保存→读取往返 */
  resetSave();
  ND.Save.data.set.vol = 0.35;
  ND.Save.data.set.muted = true;
  ND.Save.data.rec.zigzag = { bestWave: 12, bestScore: 3456, cleared: false };
  ND.Save.save();
  const raw = store['nd_save_v3'];
  ok(!!raw, '存档已写入 localStorage');
  const parsed = JSON.parse(raw);
  ok(parsed.v === 3 && parsed.sum === ND.Save.sum(ND.Save.strip(parsed)), '存档含版本号且校验和正确');
  ND.Save.data = null;
  ND.Save.load();
  ok(ND.Save.data.set.vol === 0.35 && ND.Save.data.set.muted === true, '设置项正确读回');
  ok(ND.Save.data.rec.zigzag.bestScore === 3456, '纪录正确读回');

  /* 损坏档 → 默认值 + 提示 */
  resetSave();
  writeSaveRaw('这不是JSON{{{');
  ND.Save.load();
  ok(ND.Save.data.unlock.zigzag === true && ND.Save.data.set.vol === 0.7, '损坏 JSON 回退默认值');
  ok(ND.Save.notice.length > 0, '损坏档给出提示文案');

  /* 版本不符 → 默认值 + 提示 */
  resetSave();
  const d99 = ND.Save.defaults(); d99.v = 99; d99.sum = ND.Save.sum(ND.Save.strip(d99));
  writeSaveRaw(JSON.stringify(d99));
  ND.Save.load();
  ok(ND.Save.data.v === 3 && ND.Save.notice.length > 0, '版本号过新回退默认值并提示');

  /* 篡改校验和 → 默认值 + 提示 */
  resetSave();
  const dBad = ND.Save.defaults(); dBad.sum = 'tampered';
  writeSaveRaw(JSON.stringify(dBad));
  ND.Save.load();
  ok(ND.Save.data.set.vol === 0.7 && ND.Save.notice.length > 0, '校验失败视为坏档并提示');

  /* 旧版迁移：nd_best → zigzag 最佳得分 */
  resetSave();
  sandbox.localStorage.setItem('nd_best', '5000');
  ND.Save.load();
  ok(ND.Save.data.rec.zigzag.bestScore === 5000, '旧版 nd_best 最高分迁移为 Z 字通道纪录');
  ok(!!store['nd_save_v3'], '迁移后已写入新档');

  /* 缺字段合并：局部档 + 默认兜底 */
  resetSave();
  const dPart = { v: 3, set: { vol: 0.2 } };
  dPart.sum = ND.Save.sum(ND.Save.strip(dPart));
  writeSaveRaw(JSON.stringify(dPart));
  ND.Save.load();
  ok(ND.Save.data.set.vol === 0.2 && ND.Save.data.set.muted === false, '局部档合并音量');
  ok(ND.Save.data.unlock.zigzag === true && ND.Save.data.unlock.loop === false, '局部档缺失字段回退默认');

  /* 未知地图 id 的纪录被忽略 */
  resetSave();
  const dBogus = ND.Save.defaults();
  dBogus.rec.bogus = { bestWave: 99, bestScore: 999, cleared: true };
  dBogus.sum = ND.Save.sum(ND.Save.strip(dBogus));
  writeSaveRaw(JSON.stringify(dBogus));
  ND.Save.load();
  ok(ND.Save.data.rec.bogus === undefined, '未知地图 id 纪录被忽略');

  /* 纪录单调递增 */
  resetSave();
  ND.Save.record('zigzag', 5, 100, false);
  ND.Save.record('zigzag', 3, 50, false);
  ok(ND.Save.data.rec.zigzag.bestWave === 5 && ND.Save.data.rec.zigzag.bestScore === 100, '纪录只保留更佳值');
  ND.Save.record('zigzag', 7, 200, true);
  ok(ND.Save.data.rec.zigzag.cleared === true, '通关标记正确置位');

  /* 解锁推进 */
  resetSave();
  ok(ND.Save.isUnlocked(0) === true && ND.Save.isUnlocked(1) === false, '初始仅图1可玩');
  ok(ND.Save.unlockNext(0) === '回字双环' && ND.Save.data.unlock.loop === true, '通关图1解锁图2');
  ok(ND.Save.unlockNext(2) === null, '最后一张图无后续解锁');
}

/* ================= C3：纪录/解锁与游戏流程集成 ================= */
console.log('\n---- C3 纪录与解锁集成 ----');
{
  resetSave();
  newGame(0);
  api.victory();
  ok(ND.Save.data.rec.zigzag.cleared === true && ND.Save.data.rec.zigzag.bestWave === 20, '胜利写入通关纪录');
  ok(ND.Save.data.unlock.loop === true, '胜利解锁下一张地图');
  ok(documentStub.getElementById('toast').innerHTML.includes('新地图解锁'), '解锁 Toast 提示');

  resetSave();
  newGame(0);
  G.wave = 4;
  api.gameOver();
  ok(ND.Save.data.rec.zigzag.bestWave === 4 && ND.Save.data.rec.zigzag.cleared === false, '失败写入最佳波次且不标记通关');
  ok(documentStub.getElementById('overWhy').textContent.length > 0, '失败界面给出原因提示');

  /* 返回菜单清理选中/建造状态 */
  newGame(0);
  const sp = api.goodSpots()[0];
  api.tryBuild('mg', sp.c, sp.r);
  G.selected = api.towerAt(sp.c, sp.r);
  G.buildType = 'mg';
  api.toMenu();
  ok(G.phase === 'menu' && G.selected === null && G.buildType === null, '返回主菜单清理旧输入状态');
}

/* ================= C4：音量与音频设置 ================= */
console.log('\n---- C4 音量与音频 ----');
{
  resetSave();
  const btnMute = documentStub.getElementById('btnMute');
  btnMute.fire('click');
  ok(ND.Save.data.set.muted === true && ND.Snd.on === false, '静音按钮切换并生效');
  ok(store['nd_save_v3'].includes('"muted":true'), '静音状态已持久化');
  btnMute.fire('click');
  ok(ND.Save.data.set.muted === false && ND.Snd.on === true, '再次点击恢复音效');

  const vr = documentStub.getElementById('volRange');
  vr.value = '30';
  vr.fire('input');
  ok(ND.Save.data.set.vol === 0.3 && ND.Snd.vol === 0.3, '音量滑块写入存档并应用到音频层');
  vr.value = '0'; vr.fire('input');
  ok(ND.Snd.vol === 0, '音量可调至 0');
  vr.value = '100'; vr.fire('input');
  ok(ND.Snd.vol === 1, '音量可调至 100%');

  /* 音效节流存在（倍速抽稀的基础）；倍速下 gap=2 由浏览器试玩验证 */
  ND.Snd.last = {};
  ok(ND.Snd.ok('k', 0.07) === true && ND.Snd.ok('k', 0.07) === false, '同音效最小间隔节流生效');
  resetSave();
}

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('通过 ' + passCount + ' 项 / 失败 ' + failCount + ' 项');
if (failCount > 0) { console.error('存在失败项'); process.exit(2); }
console.log('=== 全部测试通过 ===');
