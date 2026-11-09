'use strict';

/* ============================================================
 * 《墨影·守夜人》核心状态测试（第二轮）
 * 运行：node game/tests/run-tests.js
 *
 * 说明：本文件通过 DOM / Audio 桩在 Node 中按顺序加载游戏脚本
 * （config → audio → entities → weapons → game，与 index.html 一致），
 * 驱动真实的 Game 类验证规则与状态机。
 * 属于「规则验证」，不代表真实玩家试玩证据。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 浏览器环境桩 ---------- */

function makeClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, force) {
      if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
      else if (force) set.add(c); else set.delete(c);
    },
    contains(c) { return set.has(c); },
  };
}

function makeAny() {
  const fn = function () { return any; };
  const any = new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      return any;
    },
    set() { return true; },
    apply() { return any; },
    construct() { return any; },
  });
  return any;
}
const anyProxy = makeAny();

function makeElement(id) {
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    style: {},
    offsetWidth: 0,
    children: [],
    listeners: {},
    classList: makeClassList(),
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    appendChild(child) { el.children.push(child); },
    getContext() { return anyProxy; },
  };
  return el;
}

function buildSandbox() {
  const elements = {};
  const winHandlers = {};
  const docHandlers = {};
  const store = {};

  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    window: {
      addEventListener(type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); },
      removeEventListener() {},
    },
    document: {
      hidden: false,
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement(id);
        return elements[id];
      },
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    winHandlers,
    docHandlers,
    elements,
    store,
  };
  vm.createContext(sandbox);
  return sandbox;
}

const sandbox = buildSandbox();

/* ---------- 加载游戏脚本（与 index.html 相同顺序） ---------- */

const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['config.js', 'audio.js', 'entities.js', 'weapons.js', 'game.js']) {
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const x = vm.runInContext(
  '({ Game, Enemy, Zone, Player, Bullet, CONFIG, UPGRADE_POOL, EVOLUTION_POOL })',
  sandbox
);

/* ---------- 测试工具 ---------- */

function freshGame() {
  return new x.Game(makeElement('canvas'));
}
function fireKey(code, down = true, repeat = false) {
  const ev = { code, repeat, preventDefault() {} };
  for (const fn of sandbox.winHandlers[down ? 'keydown' : 'keyup'] || []) fn(ev);
}
function fireBlur() {
  for (const fn of sandbox.winHandlers.blur || []) fn({});
}
function fireVisibility(hidden) {
  sandbox.document.hidden = hidden;
  for (const fn of sandbox.docHandlers.visibilitychange || []) fn({});
}
function step(g, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) g.update(dt);
}
function noSpawn(g) { g.spawnTimer = 1e9; g.enemies = []; }
/* 帧级收集子弹（游戏每帧重建 bullets 数组，不能只钩 push 一次） */
function captureBullets(g) {
  const seen = new Set();
  const orig = g.update.bind(g);
  g.update = dt => { orig(dt); for (const b of g.bullets) seen.add(b); };
  return seen;
}
function keysReleased(g) { return Object.keys(g.keys).length === 0; }
function el(id) { return sandbox.document.getElementById(id); }

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  [通过] ' + name);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log('  [失败] ' + name + ' —— ' + err.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/* ============================================================
 * 验收 1：输入生命周期（blur / 页面隐藏 / 暂停 / 失败 / 重开）
 * ============================================================ */

test('A1-1 按住移动键后 blur：按键全释放、自动暂停、不再移动', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  fireKey('KeyW', true);
  assert(g.keys.KeyW === true, 'keydown 生效');
  const y0 = g.player.y;
  step(g, 0.2);
  assert(g.player.y < y0 - 5, '按下时向上移动');
  fireBlur();
  assert(keysReleased(g), 'blur 后按键全部释放');
  assert(g.player.dashTimer === 0, 'blur 后冲刺状态清零');
  assert(g.state === 'paused', 'blur 自动暂停');
  const y1 = g.player.y;
  step(g, 1);
  assert(g.player.y === y1, '暂停期间不移动');
});

test('A1-2 页面隐藏（visibilitychange）同 blur 处理', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  fireKey('KeyA', true);
  fireVisibility(true);
  assert(keysReleased(g), '隐藏后按键全部释放');
  assert(g.state === 'paused', '隐藏自动暂停');
  fireVisibility(false);
  assert(g.state === 'paused', '切回不自动恢复，需玩家主动继续');
});

test('A1-3 暂停冻结时间、恢复推进不漂移、旧按键不沿用', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  fireKey('KeyD', true);
  step(g, 1);
  const t1 = g.time;
  g.togglePause();
  const tp = g.time;
  step(g, 2);
  assert(g.time === tp, '暂停期间时间完全冻结');
  g.togglePause();
  assert(keysReleased(g), '暂停清空按键，恢复后不沿用旧按键');
  const t2 = g.time;
  step(g, 1);
  assert(Math.abs((g.time - t2) - 1) < 0.02, '恢复后时间推进精确无漂移');
  const x0 = g.player.x;
  step(g, 0.5);
  assert(g.player.x === x0, '未按新键时玩家不移动');
  assert(t1 > 0, '暂停前时间正常推进');
});

test('A1-4 冲刺输入状态在 blur / 暂停时清零', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  g.tryDash();
  assert(g.player.dashTimer > 0, '冲刺激活');
  fireVisibility(true);
  assert(g.player.dashTimer === 0, '隐藏后冲刺状态清零');
  g.togglePause(); /* 恢复 */
  /* 冷却属规则计时而非输入状态，保留以免「切窗刷冲刺无敌」；
     冷却按规则自然结束后即可再次冲刺 */
  step(g, x.CONFIG.dash.cd + 0.1);
  g.tryDash();
  assert(g.player.dashTimer > 0, '冷却结束后可再次冲刺');
  g.togglePause();
  assert(g.player.dashTimer === 0, '暂停后冲刺状态清零');
});

test('A1-5 失败与重开：输入清零、战斗数据重置', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  fireKey('KeyW', true);
  g.player.hp = 1;
  g.damagePlayer(10, null);
  assert(g.state === 'gameover', '生命归零进入结算');
  assert(keysReleased(g), '结算后按键全部释放');
  g.start();
  assert(g.time === 0 && g.kills === 0 && g.player.level === 1, '重开战斗数据清零');
  assert(keysReleased(g) && g.player.dashTimer === 0, '重开输入状态清零');
});

/* ============================================================
 * 验收 2：300 秒胜利结算一次性 + 结束/继续无尽 + 重开语义
 * ============================================================ */

test('A2-1 推进到 300 秒只结算一次胜利，显示时长/击杀/等级并提供两个选择', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const runsBefore = g.save.totalRuns;
  g.time = 299.6;
  step(g, 1);
  assert(g.state === 'victory', '进入胜利结算态');
  assert(g.settled === true, '结算一次性标记');
  assert(g.save.totalRuns === runsBefore + 1, '总场次只写入一次');
  const html = el('victory-stats').innerHTML;
  assert(html.indexOf('05:00') >= 0, '显示守夜时长');
  assert(html.indexOf('击杀') >= 0 && html.indexOf('等级') >= 0, '显示击杀与等级');
  assert(sandbox.document.getElementById('end-btn') && sandbox.document.getElementById('endless-btn'),
    '提供结束本局 / 继续无尽两个选择');
  step(g, 3);
  assert(g.save.totalRuns === runsBefore + 1, '后续推进不重复结算');
});

test('A2-2 继续无尽：战斗可推进、不重播胜利、不重复写纪录', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  g.time = 299.7;
  step(g, 1);
  const runs = g.save.totalRuns;
  const best = g.save.bestScore;
  g.continueEndless();
  assert(g.state === 'playing' && g.endless === true, '进入无尽模式');
  step(g, 2);
  assert(g.time > 300, '无尽战斗继续推进');
  assert(g.save.totalRuns === runs && g.save.bestScore === best, '无尽不重复写入场次与纪录');
  assert(g.state === 'playing', '无尽中不重复弹出胜利');
});

test('A2-3 无尽失败显示「已守夜成功」，保留五分钟胜利记录', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  g.time = 299.7;
  step(g, 1);
  const runs = g.save.totalRuns;
  g.continueEndless();
  step(g, 1);
  g.player.hp = 1;
  g.damagePlayer(10, null);
  assert(g.state === 'gameover', '无尽死亡进入结算');
  const title = el('over-title').textContent;
  assert(title.indexOf('无尽失败') >= 0 && title.indexOf('已守夜成功') >= 0, '标题区分无尽失败与胜利记录');
  assert(el('over-stats').innerHTML.indexOf('300 秒达成') >= 0, '保留守夜成功标记');
  assert(g.save.totalRuns === runs, '无尽死亡不重复结算');
});

test('A2-4 胜利后「结束本局」进入结算并只结算一次', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  g.time = 299.7;
  step(g, 1);
  const runs = g.save.totalRuns;
  g.gameOver(true);
  assert(g.state === 'gameover', '结束本局进入结算界面');
  assert(el('over-title').textContent.indexOf('守夜成功') >= 0, '结算标题为守夜成功');
  assert(g.save.totalRuns === runs, '结束本局不重复结算');
  g.gameOver(true);
  assert(g.save.totalRuns === runs, '重复触发结算界面不重复写入');
});

test('A2-5 胜利与死亡互斥：跨 300 秒帧优先结算胜利', () => {
  const g = freshGame();
  g.start();
  g.spawnTimer = 1e9;
  g.time = 299.99;
  g.player.hp = 1;
  g.enemies.push(new x.Enemy('mote', g.player.x, g.player.y, { hp: 1, speed: 1, dmg: 1000 }, false));
  step(g, 1 / 60);
  assert(g.state === 'victory', '胜利判定优先于同帧死亡');
  assert(g.player.hp === 1, '胜利帧不执行伤害');
});

test('A2-6 连续重开 10 次：每次战斗数据清零、结算一次、历史保留', () => {
  const g = freshGame();
  g.start();
  let prevRuns = g.save.totalRuns;
  for (let i = 0; i < 10; i++) {
    noSpawn(g);
    fireKey('KeyD', true);
    g.time = 40 + i;
    g.kills = 7 + i;
    g.player.level = 3;
    g.player.hp = 40;
    g.tryDash();
    g.gameOver();
    assert(g.save.totalRuns === prevRuns + 1, '第 ' + (i + 1) + ' 局只结算一次');
    prevRuns = g.save.totalRuns;
    g.start();
    assert(g.time === 0 && g.kills === 0 && g.player.level === 1, '第 ' + (i + 1) + ' 次重开数据清零');
    assert(g.player.hp === g.player.maxHp, '第 ' + (i + 1) + ' 次重开生命回满');
    assert(keysReleased(g) && g.player.dashTimer === 0, '第 ' + (i + 1) + ' 次重开输入清零');
    assert(g.state === 'playing', '第 ' + (i + 1) + ' 次重开进入战斗');
  }
  assert(g.save.bestScore > 0, '历史纪录保留');
});

test('A2-7 存档持久化：刷新后纪录保留，新局数据清零', () => {
  sandbox.localStorage.clear();
  const g = freshGame();
  g.start();
  noSpawn(g);
  g.kills = 30; g.time = 120; g.player.level = 6;
  g.gameOver();
  const saved = JSON.parse(sandbox.localStorage.getItem('nightwatcher_save_v1'));
  assert(saved.bestScore > 0 && saved.totalRuns === 1, '结算写入存档');
  const g2 = freshGame(); /* 模拟刷新页面 */
  assert(g2.save.bestScore === saved.bestScore && g2.save.bestLevel === 6, '刷新后纪录保留');
  g2.start();
  assert(g2.time === 0 && g2.kills === 0 && g2.player.level === 1, '新局战斗数据清零');
});

/* ============================================================
 * 验收 3a：三种武器进化（真实升级流程触发 + 效果与说明一致）
 * ============================================================ */

test('A3-1 三种进化在真实升级流程中出现并可选取（每种限一次）', () => {
  for (const id of ['orbit', 'bolt', 'thunder']) {
    const g = freshGame();
    g.start();
    const p = g.player;
    p.weapons[id] = 5;
    let card = null;
    for (let i = 0; i < 100 && !card; i++) {
      card = g.rollCards().find(u => u.type === 'evolve' && u.id === id);
    }
    assert(card, id + ' 满级后进化卡进入三选一候选');
    g.state = 'levelup';
    g.currentCards = [card];
    g.pendingLevelUps = 1;
    g.pickCard(0);
    assert(p.evolved[id] === true, id + ' 进化生效');
    assert(g.state === 'playing', '选完卡回到战斗');
    /* 一次性：进化后不再出现该进化卡 */
    for (let i = 0; i < 30; i++) {
      assert(!g.rollCards().some(u => u.type === 'evolve' && u.id === id),
        id + ' 进化卡不可重复选取');
    }
  }
});

test('A3-2 焚墨环：周期火环范围伤害 + 附加灼烧持续伤害', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  p.weapons.orbit = 5;
  p.evolved.orbit = true;
  const e = new x.Enemy('brute', p.x + 120, p.y, { hp: 10, speed: 0, dmg: 0 }, false);
  g.enemies.push(e);
  p.timers.evoRing = 0.1;
  const hp0 = e.hp;
  step(g, 1);
  assert(e.hp < hp0, '火环命中造成伤害');
  assert(e.hp < hp0 - 50, '火环伤害与说明一致（符火 Lv5 伤害 ×1.6）');
  assert(e.burnTimer > 0, '命中附加灼烧');
  const hpAfterHit = e.hp;
  step(g, 1);
  assert(e.hp < hpAfterHit, '灼烧持续造成伤害');
});

test('A3-3 贯星阵：星弹无限穿透 + 每第 5 发五星贯阵', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  p.weapons.bolt = 1;
  p.evolved.bolt = true;
  g.enemies.push(new x.Enemy('brute', p.x + 350, p.y, { hp: 5, speed: 0, dmg: 0 }, false));
  const seen = captureBullets(g);
  step(g, 5.2);
  const arr = [...seen];
  assert(arr.some(b => b.color === '#4fc9ff'), '每第 5 发化为五星贯阵');
  const normal = arr.filter(b => b.friendly && b.color !== '#4fc9ff');
  assert(normal.length > 0 && normal.every(b => b.pierce === Infinity), '进化后普通星弹全部无限穿透');
});

test('A3-4 连霆：落雷留下霆印并延迟二次爆轰', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  p.weapons.thunder = 1;
  p.evolved.thunder = true;
  const e = new x.Enemy('brute', p.x + 200, p.y, { hp: 20, speed: 0, dmg: 0 }, false);
  g.enemies.push(e);
  p.timers.thunder = 0.1;
  step(g, 0.3);
  assert(g.pendings.some(q => q.kind === 'thunder2'), '落雷处生成霆印');
  const hpMark = e.hp;
  step(g, x.CONFIG.evolution.thunder.detonateDelay + 0.3);
  assert(!g.pendings.some(q => q.kind === 'thunder2'), '霆印到时引爆并清除');
  assert(e.hp < hpMark, '二次爆轰造成额外伤害');
});

/* ============================================================
 * 验收 3b：两种新增敌人机制（预警 / 行为 / 反制）
 * ============================================================ */

test('A3-5 裂锋客：蓄力预警 → 直线冲刺（方向锁定）→ 硬直', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  p.x = 100; p.y = 300;
  const e = new x.Enemy('lancer', 620, 300, { hp: 5, speed: 1, dmg: 1 }, false);
  g.enemies.push(e);
  const states = new Set();
  for (let i = 0; i < 300; i++) { g.update(1 / 60); states.add(e.aiState); }
  assert(states.has('aim'), '进入蓄力预警状态');
  assert(states.has('dash'), '预警后直线冲刺');
  assert(states.has('recover'), '冲刺后有硬直窗口');
});

test('A3-5b 裂锋客反制：冲刺方向在蓄力时锁定，横移可躲', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  p.x = 100; p.y = 100;
  const e = new x.Enemy('lancer', 400, 300, { hp: 5, speed: 1, dmg: 1 }, false);
  g.enemies.push(e);
  e.aiState = 'aim';
  e.aiTimer = 0.05;
  e.aimX = 1; e.aimY = 0;
  const y0 = e.y;
  for (let i = 0; i < 40; i++) {
    g.update(1 / 60);
    /* 玩家大幅横移，冲刺中不再追踪 */
    p.y = 550;
  }
  assert(Math.abs(e.y - y0) < 1, '冲刺沿锁定方向，不追踪玩家');
  assert(e.aiState === 'recover' || e.aiState === 'chase', '冲刺结束进入硬直');
});

test('A3-6 墨幕使者：落点预警先于墨幕，生成后持续减速', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  const e = new x.Enemy('veil', p.x + 420, p.y, { hp: 5, speed: 1, dmg: 1 }, false);
  g.enemies.push(e);
  e.castTimer = 0.1;
  step(g, 0.2);
  assert(e.aiState === 'cast', '进入施法预警状态');
  assert(g.zones.length === 0, '预警期间尚无墨幕（预警先于区域）');
  step(g, x.CONFIG.veil.castTime + 0.15);
  assert(g.zones.some(z => z.owner === e), '预警结束后生成墨幕');
});

test('A3-6b 墨幕反制：击败使者立即驱散墨幕；墨幕内移速 75%', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  const e = new x.Enemy('veil', p.x + 420, p.y, { hp: 5, speed: 1, dmg: 1 }, false);
  g.enemies.push(e);
  e.castTimer = 0.1;
  step(g, x.CONFIG.veil.castTime + 0.3);
  assert(g.zones.some(z => z.owner === e && !z.dead), '墨幕存在');
  g.killEnemy(e);
  assert(g.zones.every(z => z.dead), '击杀使者立即驱散其墨幕');

  /* 墨幕减速规则 */
  const g2 = freshGame();
  g2.start();
  noSpawn(g2);
  const p2 = g2.player;
  g2.zones.push(new x.Zone(p2.x, p2.y, 200, 30, { slow: 0.75 }));
  fireKey('KeyD', true);
  const x0 = p2.x;
  step(g2, 1);
  const dZone = p2.x - x0;
  g2.zones = [];
  const x1 = p2.x;
  step(g2, 1);
  const dFree = p2.x - x1;
  assert(Math.abs(dZone - dFree * 0.75) < 3, '墨幕内移速为 75%');
});

/* 回归：裂锋客 / 墨幕使者必须能通过自然刷怪遇到。
 * 缺陷复现（修复前）：randomEnemyType() 刷怪池硬编码只含
 * mote/dart/spitter/brute，两种新敌人永远无法自然生成，
 * 玩家在正常游戏中遇不到新机制。 */
test('A3-7 回归·自然刷怪池包含新敌人（unlock 后可随机遇到，之前不出现）', () => {
  const g = freshGame();
  g.start();
  g.time = 100; /* 裂锋客 unlock 75s / 墨幕使者 unlock 90s 之后 */
  const seen = new Set();
  for (let i = 0; i < 800; i++) seen.add(g.randomEnemyType());
  assert(seen.has('lancer'), '时间≥75s 后裂锋客可自然刷出');
  assert(seen.has('veil'), '时间≥90s 后墨幕使者可自然刷出');

  const g2 = freshGame();
  g2.start();
  g2.time = 70; /* 尚未到 unlock 时间 */
  for (let i = 0; i < 800; i++) {
    const t = g2.randomEnemyType();
    assert(t !== 'lancer' && t !== 'veil', 'unlock 前不应刷出新敌人（出现 ' + t + '）');
  }
});

/* ============================================================
 * 验收 4：Boss 两阶段（转换一次、模式不同、死亡与胜利互斥）
 * ============================================================ */

test('A4-1 Boss 二阶段转换条件确定且只触发一次', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  const boss = new x.Enemy('boss', p.x + 500, p.y, { hp: 1, speed: 1, dmg: 1 }, false);
  g.enemies.push(boss);
  let transitions = 0;
  const orig = g.enterBossPhase2.bind(g);
  g.enterBossPhase2 = e2 => { transitions++; orig(e2); };
  assert(boss.phase === 1, '初始第一阶段');
  boss.hp = boss.maxHp * 0.49;
  step(g, 1);
  assert(boss.phase === 2 && boss.phase2Done === true, '生命低于 50% 进入第二阶段');
  boss.hp = boss.maxHp * 0.05;
  step(g, 1);
  assert(transitions === 1, '阶段转换仅触发一次');
});

test('A4-2 Boss 两阶段攻击模式不同：环形弹幕 vs 扇形墨弹 + 地面墨痕', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const p = g.player;
  const boss = new x.Enemy('boss', p.x + 500, p.y, { hp: 1, speed: 1, dmg: 1 }, false);
  g.enemies.push(boss);
  const seen = captureBullets(g);
  /* 一阶段：环形弹幕 12 发 */
  boss.shootTimer = 0.05;
  step(g, 0.2);
  const ring = [...seen].filter(b => !b.friendly);
  assert(ring.length === 12, '一阶段环形弹幕 12 发');
  /* 二阶段：扇形墨弹 + 地面墨痕 */
  seen.clear();
  g.enterBossPhase2(boss);
  boss.fanTimer = 0.05;
  boss.poolTimer = 0.05;
  step(g, 0.3);
  const fan = [...seen].filter(b => b.color === '#e0455f');
  assert(fan.length === x.CONFIG.boss2.fanCount, '二阶段扇形墨弹数量与配置一致');
  step(g, x.CONFIG.boss2.poolTelegraph + 0.3);
  assert(g.zones.some(z => z.harm > 0), '二阶段生成地面墨痕（伤害区）');
});

test('A4-3 Boss 死亡与胜利互斥：击杀 Boss 不等于通关', () => {
  const g = freshGame();
  g.start();
  noSpawn(g);
  const boss = new x.Enemy('boss', g.player.x + 500, g.player.y, { hp: 1, speed: 1, dmg: 1 }, false);
  g.enemies.push(boss);
  g.killEnemy(boss);
  assert(boss.dead && g.state === 'playing', '击杀 Boss 不触发胜利结算（胜利来自 300 秒）');
  g.player.hp = 1;
  g.damagePlayer(10, null);
  assert(g.state === 'gameover', '生命归零只触发失败结算');
});

/* ============================================================ */

console.log('');
console.log('结果：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failures.length > 0) {
  console.log('失败明细：');
  for (const f of failures) console.log('  - ' + f.name + '：' + f.err.message);
  process.exit(1);
}
process.exit(0);
