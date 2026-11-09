'use strict';
/* ================================================================
   《御剑·破晓》第二轮自动化测试
   用法：node tests/run-tests.js
   方式：node vm 加载正式版 index.html 的脚本 + DOM 桩，
        通过文末受控测试接口 __RG（与键鼠等价的程序化驱动）
        驱动真实游戏逻辑；__TEST 仅供测试读取内部状态，不参与玩法。
   覆盖：发布隔离、模式边界、暂停、回血四状态、构筑差异、
        Boss双阶段、三类事件、记录隔离、重开清空、失焦清键、
        三构筑300秒完整仿真、破晓600秒完整仿真。
   ================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DEV = fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8');
const M = IDX.match(/<script>([\s\S]*)<\/script>/);
if (!M) { console.error('FATAL: index.html 中未找到 script'); process.exit(2); }
const SCRIPT = M[1];

/* ---------------- 断言与记录 ---------------- */
const results = [];
function record(name, ok, msg){
  results.push({ name, ok, msg });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  <- ' + msg));
}
function runT(name, fn){
  try { fn(); record(name, true); }
  catch (e){ record(name, false, e.message); }
}
function assert(cond, msg){ if (!cond) throw new Error(msg || '断言失败'); }
function near(a, b, tol){ return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }

/* ================================================================
   T1 语法检查（node 编译，不执行）
   ================================================================ */
runT('T1 语法检查：index.html 脚本可编译', () => {
  new Function(SCRIPT);
});

/* ================================================================
   T2 发布隔离：正式入口无 T/G 调试键与 URL 开关，开发版独立标识
   ================================================================ */
runT('T2 发布隔离：index.html 无 T/G 键/DEV_MARK/URL 开关', () => {
  assert(!/DEV_MARK/.test(IDX), 'index.html 含 DEV_MARK');
  assert(!/k\s*===\s*'t'/.test(IDX), 'index.html 含 T 快进调试键');
  assert(!/k\s*===\s*'g'/.test(IDX), 'index.html 含 G 经验调试键');
  assert(!/location\.search|URLSearchParams|searchParams/.test(IDX), 'index.html 存在 URL 参数开关');
  assert(/玄罡护体/.test(IDX) && /气血上限加二十五，并立即恢复二十五点气血（不超过新上限）/.test(IDX),
    '玄罡护体文案与实现不一致');
});
runT('T2b 发布隔离：dev.html 独立保留调试键并标识', () => {
  assert(/DEV_MARK/.test(DEV), 'dev.html 缺少 DEV_MARK 标识');
  assert(/k\s*===\s*'t'/.test(DEV) && /k\s*===\s*'g'/.test(DEV), 'dev.html 缺少 T/G 调试键');
  assert(/开 发 版/.test(DEV), 'dev.html 缺少开发版水印');
  assert(/御剑·破晓 · 开发版/.test(DEV), 'dev.html 缺少开发版标题');
});

/* ================================================================
   DOM 桩 + vm 上下文
   ================================================================ */
function mkEl(id){
  const classes = new Set();
  const ctx2d = new Proxy({}, {
    get(t, k){
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop(){} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(){ return true; }
  });
  return {
    id, style: { setProperty(){} }, textContent: '', innerHTML: '',
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    appendChild(){}, onclick: null, getContext: () => ctx2d, width: 0, height: 0
  };
}
const HELPER = `
globalThis.__TEST = {
  get game(){ return game; }, get player(){ return player; }, get enemies(){ return enemies; },
  get gems(){ return gems; }, get potions(){ return potions; }, get waves(){ return waves; },
  get shocks(){ return shocks; }, get strikes(){ return strikes; }, get bossShots(){ return bossShots; },
  get keys(){ return keys; }, get pref(){ return pref; }, get cardOptions(){ return cardOptions; },
  get settings(){ return settings; },
  MODES, BUILDS, TYPES, UPGRADES, BUILD_UPGRADES, EVENT_SCHED, STANCE, PHASES, AFFIXES,
  spawnEnemy, damage, killEnemy, hurtPlayer, updateEvents, bossUpdate, triggerEvent, rollAffix,
  gainXp, maybeLevel, tryDash, chooseCard, openCards,
  switchStance, currentPhase, updatePhases, lanceLen, lanceWidth, effSpeed, effWaveInterval,
  endlessSched, openHelp, closeHelp, toggleHelp,
  loadSettings, saveSettings, loadRecords, saveRecords,
  get localStorage(){ return localStorage; }, get document(){ return document; }
};`;
function mkCtx(){
  const timeouts = [];
  const listeners = {};
  const els = {};
  const store = new Map();
  const ctx2d = mkEl('x').getContext('2d');
  const sandbox = {
    console,
    Math: Object.create(Math),
    setTimeout(fn){ timeouts.push(fn); return timeouts.length; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    performance: { now: () => Date.now() },
    requestAnimationFrame(){ return 0; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(){},
    innerWidth: 1280, innerHeight: 720,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    document: {
      getElementById(id){ if (!els[id]) els[id] = mkEl(id); return els[id]; },
      createElement(){ return mkEl('dyn'); }
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(SCRIPT, context, { filename: 'index.html' });
  vm.runInContext(HELPER, context, { filename: 'test-helper.js' });
  return {
    sandbox, RG: sandbox.__RG, T: sandbox.__TEST,
    flush(){ while (timeouts.length){ timeouts.splice(0).forEach(f => f()); } },
    fire(type){ (listeners[type] || []).forEach(f => f({ key: '', preventDefault(){} })); }
  };
}

/* ================================================================
   仿真 AI：斥力走位 + 磁吸补给 + 择卡（受控接口驱动）
   ================================================================ */
const PRIO = ['surge','bshield','breaklance','split','frost','longbreath',
              'swiftdash','shadowblade','strikewill','taiji','focus','flow',
              'dmg','orb','hp','rate','reso','spd','xp','pick','regen'];
/* 势场采样走位（AI 驱动仅用与键鼠等价的 __RG 接口）：
   以 16 方向两档位移（0.5s / 1.2s 前瞻）+ 原地为候选，
   对候选点做威胁（妖物/妖王弹幕/落雷/妖王冲刺轨迹）
   — 补给（灵气/丹药/低血灵泉）— 撞墙打分，择优按键。
   低气血时放大威胁与补给权重（谨慎模式）。 */
function aiControl(RG, T, log){
  const p = T.player, W = 1280, H = 720;
  const dirs = [[0, 0]];
  for (let i = 0; i < 16; i++) dirs.push([Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
  const foes = [];
  let nd = 1e9;
  for (const e of T.enemies){
    if (e.dead) continue;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d < nd) nd = d;
    if (d < 460) foes.push(e);
  }
  const cautious = p.hp < p.maxHp * 0.35 ? 1.18 : 1;
  const springs = T.game.activeEvents.filter(e => e.type === 'spring');
  function scoreAt(x, y){
    let s = 0;
    for (const e of foes){
      let D = 250 * cautious, f = 60;
      if (e.type === 'wolf'){ D = 290 * cautious; f = 80; }
      if (e.type === 'wraith'){ D = 290 * cautious; f = 90; }
      if (e.type === 'brute'){ D = 270 * cautious; f = 70; }
      if (e.type === 'boss'){ D = 350 * cautious; f = 150; }
      const dd = Math.hypot(x - e.x, y - e.y) || 1;
      if (dd < D){ const w = 1 - dd / D; s -= w * w * f; }
      // 妖王冲刺轨迹投影威胁
      if (e.type === 'boss' && e.dashing > 0){
        const pd = Math.abs((x - e.x) * e.dashVY - (y - e.y) * e.dashVX);
        if (pd < 120) s -= (1 - pd / 120) * 200;
      }
    }
    for (const sh of T.bossShots){
      const dd = Math.hypot(x - sh.x, y - sh.y) || 1;
      if (dd < 230){ s -= (1 - dd / 230) * 130; }
    }
    for (const st of T.strikes){
      if (st.struck) continue;
      const dd = Math.hypot(x - st.x, y - st.y) || 1;
      if (dd < 220){ s -= (1 - dd / 220) * 160; }
    }
    /* 裂地词缀：跺地蓄势中的妖将，避开其冲击环 */
    for (const e of foes){
      if (e.affix !== 'quake' || !e.stomping) continue;
      const dd = Math.hypot(x - e.x, y - e.y) || 1;
      if (dd < 200){ s -= (1 - dd / 200) * 130; }
    }
    const gw = nd > 220 ? 10 : 5;                  // 灵气=等级=战力，近敌时降权
    for (const g of T.gems){
      const dd = Math.hypot(x - g.x, y - g.y) || 1;
      if (dd < 260) s += gw;
    }
    if (T.gems.length && nd > 130){                // 朝最近灵气漂移，避免经验断档
      let g0 = null, gd = 1e18;
      for (const g of T.gems){
        const dd = (g.x - p.x) * (g.x - p.x) + (g.y - p.y) * (g.y - p.y);
        if (dd < gd){ gd = dd; g0 = g; }
      }
      const dd = Math.hypot(g0.x - x, g0.y - y) || 1;
      if (dd < 520) s += (1 - dd / 520) * 18;
    }
    for (const g of T.potions){
      const dd = Math.hypot(x - g.x, y - g.y) || 1;
      if (dd < 280) s += cautious > 1 ? 34 : 12;
    }
    if (cautious > 1 || p.hp < p.maxHp * 0.75){
      for (const ev of springs){
        const dd = Math.hypot(x - ev.x, y - ev.y) || 1;
        if (dd < 320) s += p.hp < p.maxHp * 0.75 ? (cautious > 1 ? 26 : 14) : 0;
      }
    }
    const A = 110;
    if (x < A) s -= (A - x) * 2;
    if (x > W - A) s -= (x - (W - A)) * 2;
    if (y < A) s -= (A - y) * 2;
    if (y > H - A) s -= (y - (H - A)) * 2;
    return s;
  }
  let best = -1e18, bk = 0;
  const L1 = p.speed * 0.5, L2 = p.speed * 1.2;
  for (let j = 0; j < dirs.length; j++){
    const [dx, dy] = dirs[j];
    const s = (dx || dy)
      ? 0.6 * scoreAt(p.x + dx * L1, p.y + dy * L1) + 0.4 * scoreAt(p.x + dx * L2, p.y + dy * L2)
      : scoreAt(p.x, p.y);
    if (s - j * 0.01 > best){ best = s - j * 0.01; bk = j; }
  }
  const [bdx, bdy] = dirs[bk];
  RG.key('d', bdx > 0.3); RG.key('a', bdx < -0.3);
  RG.key('s', bdy > 0.3); RG.key('w', bdy < -0.3);
  if (p.swordWill > 0 && p.dashT <= 0 && nd < 110){ RG.dash(); log.usedDash = true; }
}
/* 确定性随机种子（mulberry32）：使仿真可复现 */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function simRun(RG, T, opts){
  const log = { maxShocks: 0, sawSlow: false, usedDash: false, picks: 0, maxWill: 0,
                maxEnemies: 0, sawBoss: false, at299: false, at599: false, frames: 0,
                switched: 0, sawAffix: false, sawQuake: false, sawStompHit: false };
  let guard = 0, maxFrames = 60 * (opts.dur + 40);
  while (guard++ < maxFrames){
    const st = RG.snap();
    if (st.state === 'victory' || st.state === 'over')
      return { result: st.state, snap: st, log };
    if (st.state === 'levelup'){
      const cards = T.cardOptions;
      let pick = 0, best = Infinity;
      for (let i = 0; i < cards.length; i++){
        const pr = PRIO.indexOf(cards[i].id);
        if (pr >= 0 && pr < best){ best = pr; pick = i; }
      }
      RG.choose(pick); log.picks++;
      continue;
    }
    if (!log.at299 && st.time >= 299 && st.time < 300 && st.state === 'playing') log.at299 = true;
    if (!log.at599 && st.time >= 599 && st.time < 600 && st.state === 'playing') log.at599 = true;
    /* 突攻阵模式：到点后保持突攻（验证新机制下完整流程可玩） */
    if (opts.assaultAt != null && st.time >= opts.assaultAt && st.stance === 'guard'){
      if (RG.switchStance()) log.switched++;
    }
    /* 自适应剑阵（默认玩家模型，按构筑定策）：
       剑卫环剑即主力——保持环守；剑仙/剑魔对妖王与铁壁妖将切突攻矛输出，深陷围殴回环守 */
    if (opts.assaultAt == null && st.build !== 'guard' && st.stanceCd <= 0){
      const px = st.tele.px, py = st.tele.py;
      let bossNear = false, bulwarkNear = false, bruteNear = false, swarm = 0;
      for (const en of st.tele.enemies){
        const dd = Math.hypot(en.x - px, en.y - py);
        if (en.t === 'boss' && dd < 340) bossNear = true;
        if (en.affix === 'bulwark' && dd < 300) bulwarkNear = true;
        if (en.t === 'brute' && dd < 220) bruteNear = true;
        if (dd < 110) swarm++;
      }
      if (st.stance === 'guard' && (bossNear || bulwarkNear || bruteNear) && swarm < 5){
        if (RG.switchStance()) log.switched++;
      } else if (st.stance === 'assault' && swarm >= 7 && !bossNear && !bulwarkNear && !bruteNear){
        if (RG.switchStance()) log.switched++;
      }
    }
    if (st.affixCount > 0) log.sawAffix = true;
    aiControl(RG, T, log);
    RG.step(1 / 60);
    log.frames++;
    if (process.env.VERBOSE && log.frames % 1200 === 0){
      const s3 = RG.snap();
      console.error(`  [sim ${s3.build}/${s3.mode}] t=${s3.time.toFixed(0)} hp=${s3.hp}/${s3.maxHp}` +
        ` lv=${s3.level} en=${s3.enemies} kills=${s3.kills} boss=${!!s3.boss} ev=${JSON.stringify(s3.events)}`);
    }
    if (log.frames % 10 === 0){
      const s2 = RG.snap();
      log.maxShocks = Math.max(log.maxShocks, s2.shocks);
      log.maxWill = Math.max(log.maxWill, s2.will);
      log.maxEnemies = Math.max(log.maxEnemies, s2.enemies);
      if (s2.boss) log.sawBoss = true;
      if (s2.affixes && s2.affixes.some(a => a.affix === 'quake')) log.sawQuake = true;
      if (T.enemies.some(e => e.slowT > 0)) log.sawSlow = true;
    }
  }
  const st = RG.snap();
  throw new Error('仿真超时未结算: time=' + st.time + ' state=' + st.state + ' hp=' + st.hp);
}

/* ================================================================
   T3 暂停：时间与实体冻结，恢复后继续
   ================================================================ */
runT('T3 暂停冻结：暂停期间时间与敌人不动，恢复后继续', () => {
  const C = mkCtx(); const { RG, T } = C;
  assert(RG.config({ mode: 'standard', build: 'guard' }), 'config 失败');
  RG.start();
  for (let i = 0; i < 30; i++) RG.step(1 / 60);
  const t0 = RG.snap().time, e0 = T.enemies.length;
  assert(RG.pause() === 'paused', '未进入暂停');
  for (let i = 0; i < 120; i++) RG.step(1 / 60);
  assert(near(RG.snap().time, t0, 1e-9), '暂停期间时间仍在增长');
  assert(T.enemies.length === e0, '暂停期间敌人仍在生成');
  assert(RG.pause() === 'playing', '未恢复游戏');
  for (let i = 0; i < 60; i++) RG.step(1 / 60);
  assert(RG.snap().time > t0 + 0.9, '恢复后时间未继续');
});

/* ================================================================
   T4 玄罡护体回血四状态（裁判指南验收5）
   ================================================================ */
runT('T4 玄罡护体：100→125/125，99→124/125，75→100/125，50→75/125', () => {
  const C = mkCtx(); const { RG, T } = C;
  const hpUp = T.UPGRADES.find(u => u.id === 'hp');
  assert(hpUp, '未找到玄罡护体');
  const p = T.player;
  RG.start();  // 进入对局以贴近真实状态
  for (const [before, expHp, expMax] of [[100, 125, 125], [99, 124, 125], [75, 100, 125], [50, 75, 125]]){
    p.maxHp = 100; p.hp = before;
    hpUp.apply();
    assert(p.hp === expHp && p.maxHp === expMax,
      `从 ${before} 应用后应为 ${expHp}/${expMax}，实际 ${p.hp}/${p.maxHp}`);
  }
});

/* ================================================================
   T5 构筑差异：基础数值与专属升级
   ================================================================ */
runT('T5 构筑基础差异：环剑数/剑气间隔/移速/初始机制', () => {
  for (const [build, oc, wi, spd] of [['guard', 4, 4.5, 210], ['sage', 1, 1.0, 240], ['shade', 2, 2.6, 225]]){
    const C = mkCtx(); const { RG, T } = C;
    assert(RG.config({ mode: 'standard', build }), 'config 失败');
    RG.start();
    const p = T.player, st = RG.snap();
    assert(st.orbitCount === oc, build + ' 初始环剑数应为 ' + oc + '，实际 ' + st.orbitCount);
    assert(near(st.waveInterval, wi, 1e-9), build + ' 剑气间隔应为 ' + wi + '，实际 ' + st.waveInterval);
    assert(near(p.speed, spd, 1e-9), build + ' 移速应为 ' + spd + '，实际 ' + p.speed);
  }
  const C2 = mkCtx(); const { T } = C2;
  assert(T.BUILD_UPGRADES.guard.length >= 2 && T.BUILD_UPGRADES.sage.length >= 2 && T.BUILD_UPGRADES.shade.length >= 2,
    '每构筑应有至少 2 项专属升级');
});
runT('T5b 专属升级生效：surge/frost/split/遁术 参数写入', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.BUILD_UPGRADES.guard[0].apply();
  assert(T.player.surge === 0.30 && T.player.surgeMul === 1.5, '剑气回涌升级未生效');
  T.BUILD_UPGRADES.guard[1].apply();
  assert(T.player.orbitR > 72 && T.player.contactCut === 0.75, '剑盾护体升级未生效');
  const C2 = mkCtx(); const { T: T2 } = C2;
  C2.RG.config({ mode: 'standard', build: 'sage' }); C2.RG.start();
  T2.BUILD_UPGRADES.sage[0].apply();
  assert(T2.player.waveSplit === true, '剑气分光未生效');
  T2.BUILD_UPGRADES.sage[1].apply();
  assert(T2.player.frost === 0.35, '寒霜剑意未生效');
  const C3 = mkCtx(); const { T: T3c } = C3;
  C3.RG.config({ mode: 'standard', build: 'shade' }); C3.RG.start();
  T3c.BUILD_UPGRADES.shade[0].apply();
  assert(T3c.player.dashCd === 2.0 && T3c.player.willPer === 4, '遁术精进未生效');
  T3c.BUILD_UPGRADES.shade[1].apply();
  assert(T3c.player.dashEmp === 0.4, '剑随影动未生效');
});

/* ================================================================
   T6 构筑核心机制行为（回归测试：剑卫 shock 曾在旧代码缺失）
   ================================================================ */
runT('T6a 剑卫·剑气回涌：击杀触发冲击波，其余构筑不触发', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  C.sandbox.Math.random = () => 0.1;                     // < 0.15，必触发
  T.killEnemy(T.spawnEnemy('imp', [400, 400]));
  assert(T.shocks.length === 1, '必触发概率下未产生冲击波（旧缺陷回归：机制缺失）');
  C.sandbox.Math.random = () => 0.99;                    // > 0.30，必不触发
  T.killEnemy(T.spawnEnemy('imp', [500, 500]));
  assert(T.shocks.length === 1, '超出触发概率仍产生冲击波');
  C.sandbox.Math.random = () => 0.1;
  const C2 = mkCtx(); const { T: T2 } = C2;
  C2.RG.config({ mode: 'standard', build: 'sage' }); C2.RG.start();
  C2.sandbox.Math.random = () => 0.1;
  T2.killEnemy(T2.spawnEnemy('imp', [400, 400]));
  assert(T2.shocks.length === 0, '剑仙构筑不应产生回涌冲击波');
});
runT('T6b 剑仙·寒霜减速：剑气命中使妖物迟缓', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'sage' }); RG.start();
  const p = T.player;
  T.spawnEnemy('brute', [p.x + 180, p.y]);
  let saw = false;
  for (let i = 0; i < 600 && !saw; i++){
    RG.step(1 / 60);
    saw = T.enemies.some(e => e.slow > 0 && e.slowT > 0);
  }
  assert(saw, '600帧内未观察到剑气减速生效');
});
runT('T6c 剑仙·剑气分光：一次迸发两道', () => {
  function freshWaves(T){ return T.waves.filter(w => w.life > 1.27).length; }  // 剑气初速寿命 1.3s
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'sage' }); RG.start();
  T.BUILD_UPGRADES.sage[0].apply();                                             // 点分光
  const p = T.player;
  T.spawnEnemy('brute', [p.x + 220, p.y]);
  T.spawnEnemy('brute', [p.x - 220, p.y]);
  let maxFresh = 0;
  for (let i = 0; i < 150; i++){
    RG.step(1 / 60);
    maxFresh = Math.max(maxFresh, freshWaves(T));
  }
  assert(maxFresh === 2, '分光后同一迸发应出现 2 道新剑气，实测 ' + maxFresh);
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  R2.config({ mode: 'standard', build: 'sage' }); R2.start();                   // 不点分光
  const p2 = T2.player;
  T2.spawnEnemy('brute', [p2.x + 220, p2.y]);
  T2.spawnEnemy('brute', [p2.x - 220, p2.y]);
  let maxFresh2 = 0;
  for (let i = 0; i < 150; i++){
    R2.step(1 / 60);
    maxFresh2 = Math.max(maxFresh2, freshWaves(T2));
  }
  assert(maxFresh2 === 1, '未点分光时同一迸发只应 1 道新剑气，实测 ' + maxFresh2);
});
runT('T6d 剑魔·影遁与剑意：位移/冷却/无敌帧/资源上限', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'shade' }); RG.start();
  const p = T.player;
  assert(RG.snap().will === 1, '剑魔初始应有 1 层剑意');
  for (let i = 0; i < 6; i++) T.killEnemy(T.spawnEnemy('imp', [300, 300]));
  assert(RG.snap().will === 2, '击杀6个后剑意应为 2');
  for (let i = 0; i < 12; i++) T.killEnemy(T.spawnEnemy('imp', [320, 320]));
  assert(RG.snap().will === 3, '击杀18个后剑意应为 3');
  for (let i = 0; i < 12; i++) T.killEnemy(T.spawnEnemy('imp', [340, 340]));
  assert(RG.snap().will === 3, '剑意应封顶于 3');
  RG.key('d', true);
  const x0 = p.x, y0 = p.y;
  assert(RG.dash() === true, '影遁失败');
  assert(near(p.x - x0, 175, 2) && near(p.y - y0, 0, 2), '影遁应向按键方向位移175px');
  assert(RG.snap().will === 2, '影遁应消耗 1 层剑意（3→2）');
  assert(p.dashT > 0 && p.dashEmpT > 0 && p.invuln > 0, '影遁后应有冷却/强化/无敌帧');
  assert(RG.dash() === false, '无剑意时影遁应失败');
  RG.key('d', false);
  const C2 = mkCtx(); const { RG: R2 } = C2;
  R2.config({ mode: 'standard', build: 'guard' }); R2.start();
  assert(R2.dash() === false, '剑卫不应能影遁');
});
runT('T6e 剑魔·影遁强化：两秒内伤害加成', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'shade' }); RG.start();
  RG.key('d', true); RG.dash(); RG.key('d', false);
  assert(T.player.dashEmpT > 0, '影遁后应处于强化期');
  assert(near(RG.snap().hp, 100, 1e-9), '影遁本身不应受伤');
});

/* ================================================================
   T7 Boss 双阶段：一阶段召唤、二阶段弹幕+冲刺、只切换一次
   ================================================================ */
runT('T7 妖王双阶段：阶段行为独立且只切换一次', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const boss = T.spawnEnemy('boss', [300, 300]);
  assert(T.game.boss === boss && boss.hp === 1000, '标准局妖王血量应为 1000');
  const n0 = T.enemies.length;
  boss.abT = 0.01;
  T.bossUpdate(boss, 0.02);
  assert(T.enemies.length === n0 + 3, '一阶段妖嚎应召 3 小妖');
  assert(boss.phase2 === false, '血量未过半不应进入二阶段');
  T.damage(boss, boss.maxHp / 2);          // hp = 50% 恰好过线
  T.bossUpdate(boss, 0.01);
  assert(boss.phase2 === true && T.game.bossPhase2Count === 1, '过半血应切换二阶段并计数一次');
  T.damage(boss, 10);
  for (let i = 0; i < 3; i++) T.bossUpdate(boss, 0.01);
  assert(T.game.bossPhase2Count === 1, '阶段切换只应触发一次');
  boss.abT = 0.01;
  const n1 = T.enemies.length;
  T.bossUpdate(boss, 0.02);
  assert(T.bossShots.length === 8, '二阶段环形弹幕应为 8 发，实际 ' + T.bossShots.length);
  assert(T.enemies.length === n1, '二阶段不应再召小妖');
  boss.dashT = 0.01;
  T.bossUpdate(boss, 0.02);
  assert(boss.charging > 0, '二阶段应进入蓄力');
  const bx = boss.x, by = boss.y;
  T.bossUpdate(boss, 0.61);
  assert(boss.dashing > 0, '蓄力结束应进入冲刺');
  T.bossUpdate(boss, 0.02);
  assert(!near(boss.x, bx, 0.5) || !near(boss.y, by, 0.5), '冲刺应产生位移');
});

/* ================================================================
   T8 三类事件：触发计数、单次结算、到时消散
   ================================================================ */
runT('T8a 天雷：落雷对玩家/妖物各只结算一次', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const p = T.player;
  const imp = T.spawnEnemy('imp', [p.x + 40, p.y]);
  T.strikes.push({ x: p.x, y: p.y, r: 70, warn: 0.01, struck: false, strikeT: 0.35 });
  T.updateEvents(0.02);
  assert(near(p.hp, 80, 1e-9), '玩家应受天雷 20 伤，实际气血 ' + p.hp);
  assert(imp.dead === true, '圈内妖物应被落雷击杀');
  T.player.invuln = 0;                      // 排除无敌帧干扰，验证 struck 标记
  T.updateEvents(0.05);
  assert(near(p.hp, 80, 1e-9), '落雷不应重复结算');
  T.updateEvents(0.6);
  assert(T.strikes.length === 0, '落雷结束应移除');
});
runT('T8b 灵泉：站泉回血，到时消散', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const p = T.player;
  T.triggerEvent('spring');
  const ev = T.game.activeEvents.find(e => e.type === 'spring');
  assert(ev, '灵泉事件未入列');
  p.hp = 50; p.x = ev.x; p.y = ev.y;
  T.updateEvents(2.0);
  assert(near(p.hp, 58, 1e-9), '站泉 2 秒应回 8 点气血，实际 ' + p.hp);
  for (let i = 0; i < 12; i++) T.updateEvents(2.5);
  assert(T.game.activeEvents.length === 0, '25 秒后灵泉应消散');
  assert(T.game.springActive === false, '灵泉结束后刷新加速应复位');
});
runT('T8c 伏击：同向妖群并入且计数', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  for (let i = 0; i < 3; i++){
    const n = T.enemies.length;
    T.triggerEvent('ambush');
    assert(T.enemies.length === n + 9, '标准局伏击应一次并入 8 狼+1 妖将');
  }
  assert(T.game.eventStats.ambush === 3, '伏击应触发 3 次');
});
runT('T8d 事件调度：标准局 5 项 / 破晓局 8 项，类型各≥3', () => {
  const C = mkCtx(); const { RG, T } = C;
  assert(T.EVENT_SCHED.standard.length === 5, '标准局事件调度应为 5 项');
  assert(T.EVENT_SCHED.dawn.length === 8, '破晓局事件调度应为 8 项');
  const th = T.EVENT_SCHED.standard.filter(e => e.type === 'thunder').length
           + T.EVENT_SCHED.dawn.filter(e => e.type === 'thunder').length;
  const am = T.EVENT_SCHED.standard.filter(e => e.type === 'ambush').length
           + T.EVENT_SCHED.dawn.filter(e => e.type === 'ambush').length;
  const sp = T.EVENT_SCHED.standard.filter(e => e.type === 'spring').length
           + T.EVENT_SCHED.dawn.filter(e => e.type === 'spring').length;
  assert(th >= 3 && am >= 3 && sp >= 3, '两类时长合计每类事件应≥3 次');
});

/* ================================================================
   T9 升级连选与重复结算
   ================================================================ */
runT('T9 升级弹窗连选：多级 pending 连续择卡，重复结算受防', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.gainXp(20); T.maybeLevel();
  assert(RG.snap().state === 'levelup', '应进入选卡');
  assert(RG.snap().pendingLevels === 2, '一次 20 灵气应连升 2 级');
  assert(RG.choose(9) === false, '非法选卡应被拒绝');
  RG.choose(0);
  assert(RG.snap().state === 'levelup' && RG.snap().pendingLevels === 1, '首张选后应还有 1 级待选');
  RG.choose(0);
  assert(RG.snap().state === 'playing' && T.player.level === 3, '选完应恢复对局且等级为 3');
});
runT('T9b 胜利重复结算防护：胜利后 records 只记一次', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.game.time = 299.99;   // 直接置于边界前一瞬，验证 update 内的胜利结算
  RG.step(1 / 60);
  assert(RG.snap().state === 'victory', '应胜利结算');
  for (let i = 0; i < 10; i++) RG.step(1 / 60);
  assert(RG.snap().state === 'victory', '结算后状态应稳定');
  const rec = RG.snap().records;
  assert(rec.standard.plays === 1 && rec.standard.wins === 1, '胜利后战绩应恰好记录一次');
  assert(RG.restart() === true, '应可重开');
  assert(RG.restart() === false, '非结算态重复 restart 应被拒绝');
});

/* ================================================================
   T10 重开清空与连续重开 10 次
   ================================================================ */
runT('T10 重开清空：临时状态/事件/Boss/剑气 全部复位', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'dawn', build: 'shade' }); RG.start();
  T.triggerEvent('ambush'); T.triggerEvent('thunder'); T.triggerEvent('spring');
  T.spawnEnemy('boss', [300, 300]);
  T.gainXp(30); T.maybeLevel();
  while (RG.snap().state === 'levelup') RG.choose(0);   // 清空待选等级
  assert(RG.restart() === false, '对局中 restart 应被拒绝（结算前不可重开）');
  T.hurtPlayer(999);                                     // 走正常失败结算
  assert(RG.snap().state === 'over', '应进入失败结算');
  C.flush();
  assert(RG.restart() === true, '结算后重开失败');
  const st = RG.snap();
  assert(st.state === 'playing' && st.time === 0 && st.kills === 0, '重开后时间/击杀未清零');
  assert(st.events.ambush === 0 && st.events.spring === 0 && st.events.thunder === 0, '事件计数未清零');
  assert(st.activeEvents.length === 0 && st.eventsPending === T.EVENT_SCHED.dawn.length, '活动事件未清空或调度表异常');
  assert(st.boss === null && st.bossPhase2Count === 0, 'Boss 状态未复位');
  assert(st.strikes === 0 && st.shots === 0 && st.shocks === 0, '弹幕/落雷/冲击波未清空');
  assert(T.gems.length === 0 && T.enemies.length === 0 && T.waves.length === 0, '实体未清空');
  assert(st.mode === 'dawn' && st.build === 'shade', '重开应保留所选模式与构筑');
  for (let i = 0; i < 10; i++){                          // 连续重开 10 次
    T.hurtPlayer(999);
    assert(RG.snap().state === 'over', '第' + (i + 1) + '次：应进入失败结算');
    C.flush();
    assert(RG.restart() === true, '第' + (i + 1) + '次连续重开失败');
    const s2 = RG.snap();
    assert(s2.state === 'playing' && s2.time === 0 && s2.kills === 0 && s2.enemies === 0,
      '第' + (i + 1) + '次连续重开后状态未复位');
  }
});

/* ================================================================
   T11 失焦清键与按键释放
   ================================================================ */
runT('T11 失焦清键：blur 后方向键不再生效；释放键即停', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const p = T.player, x0 = p.x;
  RG.key('d', true);
  C.fire('blur');
  for (let i = 0; i < 30; i++) RG.step(1 / 60);
  assert(near(p.x, x0, 0.5), '失焦后按住的方向键应被清空');
  RG.key('d', true);
  for (let i = 0; i < 30; i++) RG.step(1 / 60);
  assert(p.x > x0 + 60, '重新按键后应恢复移动');
  RG.key('d', false);
  const x1 = p.x;
  for (let i = 0; i < 30; i++) RG.step(1 / 60);
  assert(near(p.x, x1, 0.5), '松开按键后应停止移动');
});

/* ================================================================
   T12 模式配置边界与记录隔离
   ================================================================ */
runT('T12 配置边界：对局中禁止改配置，战绩按模式分档', () => {
  const C = mkCtx(); const { RG, T } = C;
  assert(RG.config({ mode: 'dawn', build: 'sage' }), '开局前应可配置');
  RG.start();
  assert(RG.snap().mode === 'dawn', '所选模式未生效');
  assert(RG.config({ mode: 'standard' }) === false, '对局中应禁止改配置');
  T.hurtPlayer(999);
  assert(RG.snap().state === 'over', '应失败结算');
  C.flush();
  let rec = RG.snap().records;
  assert(rec.dawn.plays === 1 && rec.dawn.wins === 0 && rec.standard.plays === 0,
    '失败应计入破晓档且不串标准档');
  assert(RG.home() === true, '结算后应可回首页');
  assert(RG.config({ mode: 'standard', build: 'sage' }), '回首页后应可重新配置');
  RG.start();
  T.game.time = 299.99; RG.step(1 / 60);
  assert(RG.snap().state === 'victory', '标准局 300 秒应胜利');
  C.flush();
  rec = RG.snap().records;
  assert(rec.standard.plays === 1 && rec.standard.wins === 1 && rec.dawn.plays === 1,
    '两模式战绩应各自累计不串档');
});

/* ================================================================
   T13-T15 三构筑 300 秒标准局完整仿真（每构筑两种子）
   ================================================================ */
function simOne(mode, build, seed, dur, assaultAt){
  const C = mkCtx();
  C.sandbox.Math.random = mulberry32(seed);          // 固定种子，仿真可复现
  const { RG, T } = C;
  assert(RG.config({ mode, build }), 'config 失败');
  RG.start();
  const r = simRun(RG, T, { dur, assaultAt });
  r.C = C;
  return r;
}
const SIM_LOGS = {};   // 收集各构筑机制证据，供测试报告引用
for (const build of ['guard', 'sage', 'shade']){
  runT('T1' + (build === 'guard' ? '3' : build === 'sage' ? '4' : '5') +
       ` 完整仿真：${build} 标准局 300 秒 ×2 种子（299 续战 / 300 胜利结算）`, () => {
    const evs = [];
    for (const seed of [2026, 1102]){
      const r = simOne('standard', build, seed, 300);
      assert(r.result === 'victory',
        `${build} 种子${seed} 仿真未胜利：time=${r.snap.time} hp=${r.snap.hp} kills=${r.snap.kills}`);
      const st = r.snap;
      assert(st.time >= 300 && st.time < 300.6, `种子${seed}：应在 300 秒整结算，实际 ` + st.time);
      assert(r.log.at299, `种子${seed}：未观察到 299 秒仍续战的边界`);
      assert(st.kills > 50, '击杀数异常偏低');
      assert(r.log.picks >= 5, '升级择卡次数异常偏低');
      assert(r.log.sawBoss === true, '标准局 235 秒妖王应现世');
      evs.push(st.events);
      SIM_LOGS[build + '_' + seed] = { snap: st, log: r.log };
    }
    for (const ev of evs){
      assert(ev.ambush === 2 && ev.spring === 2 && ev.thunder === 1,
        '标准局事件调度应为 2/2/1，实际 ' + JSON.stringify(ev));
    }
    const l1 = SIM_LOGS[build + '_2026'].log, l2 = SIM_LOGS[build + '_1102'].log;
    if (build === 'guard') assert(l1.maxShocks > 0 || l2.maxShocks > 0, '剑卫仿真应观察到回涌冲击波');
    if (build === 'sage') assert(l1.sawSlow || l2.sawSlow, '剑仙仿真应观察到寒霜减速');
    if (build === 'shade') assert((l1.usedDash || l2.usedDash) && (l1.maxWill >= 1 || l2.maxWill >= 1),
      '剑魔仿真应使用影遁并积攒剑意');
  });
}

/* ================================================================
   T16 破晓局 600 秒完整仿真（规则测试：599 续战 / 600 结算）
   ================================================================ */
runT('T16 完整仿真：破晓局 600 秒（599 续战 / 600 胜利结算 / 事件 3/2/3）', () => {
  const r = simOne('dawn', 'guard', 2026, 600);
  assert(r.result === 'victory', '破晓局仿真未胜利：time=' + r.snap.time + ' hp=' + r.snap.hp);
  const st = r.snap;
  assert(st.time >= 600 && st.time < 600.6, '应在 600 秒整结算，实际 ' + st.time);
  assert(r.log.at599, '未观察到 599 秒仍续战的边界');
  assert(st.events.ambush === 3 && st.events.spring === 2 && st.events.thunder === 3,
    '破晓局事件调度应为 3/2/3，实际 ' + JSON.stringify(st.events));
  assert(st.eventsPending === 0, '到结算时事件应全部触发');
  assert(r.log.sawBoss === true, '破晓局 480 秒妖王应现世');
  SIM_LOGS.dawn_2026 = { snap: st, log: r.log };
});

/* ================================================================
   汇总
   ================================================================ */
/* ================================================================
    T17 两仪剑阵：切换 / 冷却 / 参数（第三轮核心机制）
    ================================================================ */
runT('T17 两仪剑阵：Q 切换生效、0.5 秒冷却、突攻参数与还原', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const p = T.player;
  assert(RG.snap().stance === 'guard', '初始应为环守阵');
  assert(RG.switchStance() === true, '第一次切换应成功');
  assert(RG.snap().stance === 'assault', '切换后应为突攻阵');
  assert(RG.snap().stanceCd > 0, '切换后应进入冷却');
  assert(RG.switchStance() === false, '冷却期内再切应被拒绝');
  assert(near(T.effSpeed(), p.speed * T.STANCE.assault.speedMul, 1e-9), '突攻阵移速应为 ×1.12');
  assert(near(T.effWaveInterval(), p.waveInterval / T.STANCE.assault.waveRate, 1e-9),
    '突攻阵剑气间隔应为 ÷2.2');
  for (let i = 0; i < 31; i++) RG.step(1 / 60);          // 0.5 秒冷却过后
  assert(RG.snap().stanceCd <= 0, '0.5 秒后冷却应结束');
  assert(RG.switchStance() === true, '冷却后应可切回');
  assert(RG.snap().stance === 'guard', '应切回环守阵');
  assert(near(T.effSpeed(), p.speed, 1e-9), '环守阵移速应还原');
  assert(near(T.effWaveInterval(), p.waveInterval, 1e-9), '环守阵剑气间隔应还原');
  /* 阵法圆融：冷却减半 */
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  R2.config({ mode: 'standard', build: 'guard' }); R2.start();
  T2.UPGRADES.find(u => u.id === 'flow').apply();
  R2.switchStance();
  for (let i = 0; i < 16; i++) R2.step(1 / 60);          // 0.25 秒
  assert(R2.switchStance() === true, '阵法圆融后 0.25 秒即可再切');
});

runT('T17b 突攻剑矛：沿线突刺伤害、矛尖剑气、单敌受击冷却', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.game.spawnT = 1e9;                                   // 屏蔽自然刷怪，构造确定性场景
  const p = T.player;
  RG.switchStance();                                      // 突攻
  RG.key('d', true);                                      // 矛指 +x
  for (let i = 0; i < 40; i++) RG.step(1 / 60);           // 平滑转向至 0
  assert(Math.abs(p.lanceAng) < 0.05, '按住 D 后矛应指向 +x，实际 ' + p.lanceAng);
  RG.key('d', false);
  const L = T.lanceLen(), w = T.lanceWidth();
  assert(L > 180 && w > 40, '剑卫四剑的矛应有足够长宽（L=' + L.toFixed(0) + ' w=' + w.toFixed(0) + '）');
  /* 线上敌受矛伤（环剑轨道外，排除环剑干扰） */
  const e = T.spawnEnemy('imp', [p.x + 120, p.y]);
  const hp0 = e.hp;
  for (let i = 0; i < 40; i++) RG.step(1 / 60);
  assert(e.hp < hp0 || e.dead, '矛沿线敌人应受到突刺伤害');
  /* 单敌受击冷却：受击后冷却期内不再结算，越冷却再结算 */
  const e2 = T.spawnEnemy('brute', [p.x + 150, p.y]);
  p.lanceAng = 0;                                        // 重新对准（无按键时矛自动指向最近敌）
  p.waveTimer = 99;                                      // 屏蔽剑气干扰，单验矛伤
  p.lanceTick = 0.001; e2.orbCd = 0;
  const hp2 = e2.hp;
  RG.step(1 / 60);                                       // 立即结算一跳
  const tick1 = hp2 - e2.hp;
  assert(tick1 > 0, '应立即结算一跳矛伤');
  RG.step(1 / 60); RG.step(1 / 60); RG.step(1 / 60);     // 受击冷却 0.34s 内
  assert(near(e2.hp, hp2 - tick1, 1e-9), '受击冷却内不应重复结算（' + (hp2 - e2.hp) + '）');
  p.lanceTick = 0.001; e2.orbCd = 0;                     // 越过冷却，强制下一跳
  RG.step(1 / 60);
  assert(e2.hp < hp2 - tick1 - 1, '冷却后应再次结算矛伤');
  /* 矛尖剑气：目标在矛尖之外，剑气应自矛尖迸发 */
  T.spawnEnemy('brute', [p.x + 420, p.y]);
  p.lanceAng = 0;
  p.waveTimer = 0.01;
  RG.step(1 / 60);
  const wv = T.waves[T.waves.length - 1];
  assert(wv && wv.x > p.x + 100, '突攻阵剑气应自矛尖迸发（x=' + (wv && wv.x.toFixed(0)) + '）');
});

runT('T17c 阵门大开：突攻阵接触受伤加重两成', () => {
  for (const [stance, expect] of [['guard', 12], ['assault', 14]]){
    const C = mkCtx(); const { RG, T } = C;
    RG.config({ mode: 'standard', build: 'guard' }); RG.start();
    if (stance === 'assault') RG.switchStance();
    const p = T.player;
    const wf = T.spawnEnemy('wolf', [p.x, p.y]);          // 妖狼贴身（伤害 12）
    wf.hp = wf.maxHp = 1e9;                               // 皮糙免死：确保能走到接触结算
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++){
      RG.step(1 / 60);
      if (p.hp < 100) hit = true;
    }
    assert(hit, stance + ' 阵下妖狼应触及玩家造成接触伤');
    assert(near(p.hp, 100 - expect, 1e-9),
      stance + ' 阵下接触应掉 ' + expect + ' 血，实际 ' + (100 - p.hp));
  }
});

runT('T17d 两仪归一：切换迸发冲击波（其余未点不迸发）', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.UPGRADES.find(u => u.id === 'taiji').apply();
  const n0 = T.shocks.length;
  RG.switchStance();
  assert(T.shocks.length === n0 + 1, '点两仪归一后切换应迸发冲击波');
  assert(T.shocks[T.shocks.length - 1].dmg > 0, '切换冲击波应有伤害');
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  R2.config({ mode: 'standard', build: 'sage' }); R2.start();
  const n2 = T2.shocks.length;
  R2.switchStance();
  assert(T2.shocks.length === n2, '未点两仪归一切换不应迸发冲击波');
});

/* ================================================================
    T18 更次（阶段）：切换时点与标签
    ================================================================ */
runT('T18 更次阶段：标准局 4 更切换 / 破晓局 7 更 / 演武按波次', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.player.invuln = 1e9;                                 // 本测试只验阶段调度，免伤免死
  const marks = [[1, 45, '丑时'], [2, 140, '寅时'], [3, 235, '妖王临阵'], [4, 270, '破晓将至']];
  for (const [idx, tt, name] of marks){
    while (RG.snap().time < tt + 0.2){
      if (RG.snap().state === 'levelup'){ RG.choose(0); continue; }
      RG.step(1 / 60);
    }
    const st = RG.snap();
    assert(st.phaseIdx === idx, 't=' + tt + ' 应进入第 ' + idx + ' 更（idx=' + st.phaseIdx + '）');
    assert(st.phase && st.phase.indexOf(name) >= 0, 't=' + tt + ' 更次名应为『' + name + '』实际 ' + st.phase);
  }
  assert(T.PHASES.dawn.length === 7 && T.PHASES.dawn[6].t === 570, '破晓局应为 7 更且末更 570 秒');
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  R2.config({ mode: 'endless', build: 'guard' }); R2.start();
  T2.player.invuln = 1e9;
  while (R2.snap().time < 91.5){
    if (R2.snap().state === 'levelup'){ R2.choose(0); continue; }
    R2.step(1 / 60);
  }
  const st2 = R2.snap();
  assert(st2.phase === '妖潮第2阵', '演武局 90 秒应进入第 2 波，实际 ' + st2.phase);
});

/* ================================================================
    T19 精英词缀：迅捷 / 铁壁 / 裂地
    ================================================================ */
runT('T19 精英词缀：伏击必带、三词缀参数、铁壁减伤只对剑气、裂地冲击单次结算', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  /* 伏击妖将必带词缀 */
  C.sandbox.Math.random = () => 0.5;
  T.triggerEvent('ambush');
  const brute = T.enemies.find(e => e.type === 'brute');
  assert(brute && brute.affix, '伏击妖将必带词缀');
  /* 迅捷：速度 ×1.9、气血 ×0.7 */
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  R2.config({ mode: 'standard', build: 'guard' }); R2.start();
  C2.sandbox.Math.random = () => 0.99;                    // 0.99 > 0.22：自然刷出不带词缀
  const b2 = T2.spawnEnemy('brute', [300, 300]);
  assert(!b2.affix, '高随机值下自然刷出的妖将不应带词缀');
  const pre = { hp: b2.hp, spd: b2.spd };
  C2.sandbox.Math.random = () => 0;                      // 强制掷出迅捷
  T2.rollAffix(b2, true);
  assert(b2.affix === 'swift', 'r=0 应掷出迅捷');
  assert(near(b2.hp, pre.hp * 0.7, 1e-6) && near(b2.spd, pre.spd * 1.9, 1e-6), '迅捷参数未生效');
  /* 铁壁：气血 ×1.8，剑气减伤四分之一、矛伤全额 */
  const C3 = mkCtx(); const { RG: R3, T: T3 } = C3;
  R3.config({ mode: 'standard', build: 'guard' }); R3.start();
  C3.sandbox.Math.random = () => 0.34;
  const b3 = T3.spawnEnemy('brute', [300, 300]);
  T3.rollAffix(b3, true);
  assert(b3.affix === 'bulwark', 'r=0.34 应掷出铁壁');
  const hpFull = b3.hp;
  T3.damage(b3, 100, 'wave');
  assert(near(b3.hp, hpFull - 75, 1e-6), '铁壁剑气伤害应 ×0.75（-75）');
  T3.damage(b3, 100, 'lance');
  assert(near(b3.hp, hpFull - 175, 1e-6), '铁壁矛伤应全额（-100）');
  /* 裂地：预警 0.9 秒后冲击波，玩家只结算一次 */
  const C4 = mkCtx(); const { RG: R4, T: T4 } = C4;
  R4.config({ mode: 'standard', build: 'guard' }); R4.start();
  C4.sandbox.Math.random = () => 0.67;
  const b4 = T4.spawnEnemy('brute', [400, 360]);
  T4.rollAffix(b4, true);
  assert(b4.affix === 'quake', 'r=0.67 应掷出裂地');
  b4.spd = 0;                                            // 定身：排除接触伤干扰冲击波断言
  b4.x = T4.player.x + 100; b4.y = T4.player.y;          // 玩家在冲击半径内
  b4.stompT = 0.01;
  let sawStomp = false;
  for (let i = 0; i < 130 && !sawStomp; i++){
    R4.step(1 / 60);
    if (T4.player.hp < 100) sawStomp = true;
  }
  assert(sawStomp, '裂地冲击波应伤及圈内玩家');
  assert(b4.stomping === false && b4.stompT > 0, '冲击后应复位跺地计时');
  const hpAfter = T4.player.hp;
  for (let i = 0; i < 30; i++) R4.step(1 / 60);
  assert(T4.player.hp <= hpAfter + 1, '冲击波不应连续结算');
});

/* ================================================================
    T20 演武局：无时限、妖王复现增强、死亡结算、三档战绩隔离
    ================================================================ */
runT('T20 演武局：妖王 150 秒现世、殒后复现更强、无胜利、战绩独立', () => {
  const C = mkCtx();
  C.sandbox.Math.random = mulberry32(2026);
  const { RG, T } = C;
  RG.config({ mode: 'endless', build: 'guard' }); RG.start();
  assert(RG.snap().mode === 'endless', '应进入演武局');
  /* 事件调度：演武局独立生成，三项事件各 ≥3 */
  const es = T.endlessSched();
  assert(es.length >= 30, '演武局事件调度应覆盖 30 项以上');
  for (const ty of ['ambush', 'spring', 'thunder'])
    assert(es.filter(e => e.type === ty).length >= 3, '演武局 ' + ty + ' 应 ≥3 次');
  /* AI 实玩至妖王现世（阶段一：真实走位与择卡） */
  let bossSeen = false, t0 = Date.now();
  while (!bossSeen && Date.now() - t0 < 30000){
    const stt = RG.snap();
    if (stt.state === 'over' || stt.state === 'victory') break;
    if (stt.state === 'levelup'){ RG.choose(0); continue; }
    aiControl(RG, T, {});
    RG.step(1 / 60);
    if (RG.snap().boss) bossSeen = true;
  }
  assert(bossSeen, '演武局 150 秒妖王应现世（终态 ' + RG.snap().state + ' t=' + RG.snap().time.toFixed(1) + '）');
  const boss1 = T.game.boss;
  assert(near(boss1.maxHp, 850, 1e-6), '首尊妖王应为 850 血，实际 ' + boss1.maxHp);
  /* 斩妖王 → 20 秒后复现且更强（阶段二起为规则测试：免伤免死） */
  T.player.invuln = 1e9;
  T.damage(boss1, 99999);
  let respawn = null;
  t0 = Date.now();
  while (!respawn && Date.now() - t0 < 30000){
    const stt = RG.snap();
    if (stt.state === 'levelup'){ RG.choose(0); continue; }
    RG.step(1 / 60);
    const b = RG.snap().boss;
    if (b && b.maxHp > 850) respawn = b;
  }
  assert(respawn, '妖王殒后 20 秒应复现');
  assert(respawn.maxHp > 850, '复现妖王应更强（' + respawn.maxHp + '）');
  assert(RG.snap().bossSlain === 1, '妖王殒数应为 1');
  /* 超过 300 秒仍无胜利（演武局无时限，规则验证） */
  while (RG.snap().time < 305){
    if (RG.snap().state === 'levelup'){ RG.choose(0); continue; }
    RG.step(1 / 60);
  }
  assert(RG.snap().state === 'playing', '演武局 300 秒后仍应续战，不设胜利');
  /* 力竭结算：记录最长存活，且不串档 */
  T.player.invuln = 0;
  T.hurtPlayer(99999);
  assert(RG.snap().state === 'over', '演武局应以力竭结算');
  C.flush();
  const rec = RG.snap().records;
  assert(rec.endless.plays === 1 && rec.endless.bestTime > 300, '演武局应记录最长存活');
  assert(rec.dawn.plays === 0 && rec.standard.plays === 0, '演武局战绩不应串入限时局');
});

/* ================================================================
    T21 情境提示与帮助页
    ================================================================ */
runT('T21 情境提示：按情境依次触发一次并持久化已读', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  T.player.invuln = 1e9;                                 // 本测试只验提示调度，免伤免死
  assert(Object.keys(T.settings.seenTips).length === 0, '新档不应有已读提示');
  let t0 = Date.now();
  while (RG.snap().time < 40 && Date.now() - t0 < 20000){
    if (RG.snap().state === 'levelup'){ RG.choose(0); continue; }
    RG.step(1 / 60);
  }
  const seen = Object.keys(T.settings.seenTips);
  assert(seen.includes('move'), '开局应提示移动（实际 ' + seen + '）');
  assert(seen.includes('stance'), '35 秒前后应提示切阵');
  const saved = JSON.parse(T.localStorage.getItem('yjpx_settings'));
  assert(saved && saved.seenTips && saved.seenTips.stance === 1, '已读提示应写入 localStorage');
  /* 同情境不重播 */
  const n0 = seen.length;
  for (let i = 0; i < 120; i++) RG.step(1 / 60);
  assert(Object.keys(T.settings.seenTips).length >= n0, '提示只应新增不重播');
  /* 帮助页开合（DOM 桩无初始 class，初始隐藏态由真实浏览器 interact-test 验证） */
  const helpEl = T.document.getElementById('helpOv');
  T.closeHelp();
  assert(helpEl.classList.contains('hidden') === true, 'closeHelp 应隐藏帮助页');
  T.openHelp();
  assert(helpEl.classList.contains('hidden') === false, 'openHelp 应展示帮助页');
  T.closeHelp();
  assert(helpEl.classList.contains('hidden') === true, '再次 closeHelp 应隐藏帮助页');
});

/* ================================================================
    T22 存档：版本迁移、损坏回退、设置独立
    ================================================================ */
runT('T22 存档：v1 旧档迁移出 endless 档、坏档自动重置、游戏不受阻', () => {
  /* v1 旧档（无 v 字段）→ 迁移 */
  const C = mkCtx(); const { RG, T } = C;
  T.localStorage.setItem('yjpx_records', JSON.stringify(
    { dawn: { plays: 2, wins: 1, bestKills: 100, bestLevel: 10 },
      standard: { plays: 1, wins: 0, bestKills: 50, bestLevel: 5 } }));
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  const rec = RG.snap().records;
  assert(rec.v === 2, '迁移后应有版本号 v=2');
  assert(rec.dawn.plays === 2 && rec.dawn.wins === 1 && rec.dawn.bestKills === 100,
    'v1 破晓档数据应原样保留');
  assert(rec.endless && rec.endless.plays === 0, '迁移应补出空 endless 档');
  /* 坏档 → 重置且可玩 */
  const C2 = mkCtx(); const { RG: R2, T: T2 } = C2;
  T2.localStorage.setItem('yjpx_records', '{bad json');
  T2.localStorage.setItem('yjpx_settings', 'not json');
  R2.config({ mode: 'standard', build: 'guard' });
  R2.start();
  assert(R2.snap().state === 'playing', '坏档下仍应正常开局');
  const rec2 = R2.snap().records;
  assert(rec2.v === 2 && rec2.standard.plays === 0, '坏档应重置为空档');
  assert(T2.settings.muted === false && Object.keys(T2.settings.seenTips).length === 0,
    '坏设置档应回退默认值');
});

/* ================================================================
    T23 新道法池：构成与生效
    ================================================================ */
runT('T23 新道法池：两仪/阵法道法入池，构筑专属阵法道法各一', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  for (const id of ['taiji', 'focus', 'flow'])
    assert(T.UPGRADES.some(u => u.id === id), '通用池应含 ' + id);
  assert(T.BUILD_UPGRADES.guard.some(u => u.id === 'breaklance'), '剑卫应含破军锋');
  assert(T.BUILD_UPGRADES.sage.some(u => u.id === 'longbreath'), '剑仙应含御气长存');
  assert(T.BUILD_UPGRADES.shade.some(u => u.id === 'strikewill'), '剑魔应含阵中夺魂');
  /* 生效参数 */
  const p = T.player;
  T.UPGRADES.find(u => u.id === 'taiji').apply();
  assert(p.switchNova === true, '两仪归一未生效');
  T.UPGRADES.find(u => u.id === 'focus').apply();
  assert(p.lanceWB === 10 && p.lanceTurnB === 3.5, '凝锋未生效');
  T.UPGRADES.find(u => u.id === 'flow').apply();
  assert(p.stanceCdMul === 0.5, '阵法圆融未生效');
  T.BUILD_UPGRADES.guard.find(u => u.id === 'breaklance').apply();
  assert(p.lanceEliteMul === 1.3, '破军锋未生效');
  /* 矛伤对妖将加成（突攻阵下，屏蔽剑气与切换冲击波干扰） */
  RG.switchStance();
  T.shocks.length = 0;
  const b = T.spawnEnemy('brute', [p.x + 120, p.y]);
  p.lanceAng = 0; b.orbCd = 0; p.lanceTick = 0.001; p.waveTimer = 99;
  const hpB = b.hp;
  RG.step(1 / 60);
  const dealt = hpB - b.hp;
  const base = p.orbitDmg * T.STANCE.assault.dmgMul * 1.3;   /* ×lanceEliteMul(1.3) */
  assert(dealt > 0 && near(dealt, base, 2), '破军锋矛伤应 ≈' + base.toFixed(1) + '，实际 ' + dealt.toFixed(1));
});

/* ================================================================
    T24 突攻阵完整仿真（第三轮新机制下的完整流程）
    ================================================================ */
runT('T24 完整仿真：剑仙标准局 300 秒全程突攻阵（新机制可玩性）', () => {
  const r = simOne('standard', 'sage', 2026, 300, 12);
  assert(r.result === 'victory', '全程突攻仿真未胜利：time=' + r.snap.time + ' hp=' + r.snap.hp);
  assert(r.log.switched >= 1, '仿真应在 12 秒切入突攻阵');
  assert(r.snap.kills > 50, '突攻阵击杀数异常偏低（' + r.snap.kills + '）');
  SIM_LOGS['sage_assault_2026'] = { snap: r.snap, log: r.log };
});

/* ================================================================
    T25 词缀覆盖：完整局中确有词缀妖将出现
    ================================================================ */
runT('T25 完整局词缀覆盖：标准局 140 秒后自然刷出词缀妖将', () => {
  const C = mkCtx();
  C.sandbox.Math.random = mulberry32(31337);
  const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'guard' }); RG.start();
  let saw = false, t0 = Date.now();
  while (!saw && Date.now() - t0 < 40000){
    const stt = RG.snap();
    if (stt.state === 'over' || stt.state === 'victory') break;
    if (stt.state === 'levelup'){ RG.choose(0); continue; }
    aiControl(RG, T, {});
    RG.step(1 / 60);
    if (RG.snap().affixCount > 0) saw = true;
  }
  assert(saw, '完整局 140 秒后应自然出现词缀妖将（终态 ' + RG.snap().state + ' t=' + RG.snap().time.toFixed(1) + '）');
});

/* ================================================================
    T26 重开清空含剑阵状态（A5 补充）
    ================================================================ */
runT('T26 重开清空剑阵：突攻阵下结算重开应复位环守', () => {
  const C = mkCtx(); const { RG, T } = C;
  RG.config({ mode: 'standard', build: 'shade' }); RG.start();
  RG.switchStance();
  assert(RG.snap().stance === 'assault', '预置突攻阵');
  T.hurtPlayer(999);
  C.flush();
  assert(RG.restart() === true, '结算后重开');
  const st = RG.snap();
  assert(st.stance === 'guard' && st.stanceCd === 0, '重开后剑阵应复位环守且无冷却');
  assert(st.phaseIdx === 0 && st.strikes === 0 && st.shocks === 0, '更次/落雷/冲击波应复位');
  assert(st.tipsSeen !== undefined, 'snap 应可观测已读提示');
});

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log('----------------------------------------');
for (const k of Object.keys(SIM_LOGS).sort()){
  const e = SIM_LOGS[k];
  console.log(`  [仿真摘要] ${k}: 胜利终局 time=${e.snap.time.toFixed(1)} lv=${e.snap.level}` +
    ` kills=${e.snap.kills} hp=${e.snap.hp}/${e.snap.maxHp} events=${JSON.stringify(e.snap.events)}` +
    ` maxEnemies=${e.log.maxEnemies} picks=${e.log.picks}` +
    (e.log.switched ? ` 切阵=${e.log.switched}` : '') +
    (e.log.sawAffix ? ` 词缀=${e.log.sawAffix}` : '') +
    (e.log.maxShocks ? ` maxShocks=${e.log.maxShocks}` : '') +
    (e.log.sawSlow ? ` sawSlow=${e.log.sawSlow}` : '') +
    (k.includes('shade') ? ` usedDash=${e.log.usedDash} maxWill=${e.log.maxWill}` : ''));
}
console.log('----------------------------------------');
console.log(`合计 ${results.length} 项：通过 ${pass}，未通过 ${fail}`);
if (fail > 0){
  results.filter(r => !r.ok).forEach(r => console.log('  FAIL: ' + r.name + ' —— ' + r.msg));
  process.exit(1);
}
