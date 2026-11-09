/* =========================================================
 * tools/regress.js —— 第二轮回归测试
 *
 * 设计目的：为「已确认的状态缺陷」保留可复现的失败条件。
 * 每项测试在隔离的 VM 沙箱里真实加载前端脚本（或引擎源码），
 * 因此同一份测试既能在修复前展示失败，也能在修复后验证通过。
 *
 * 用法：node tools/regress.js
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');
const audit = require('./audit.js');
const guardEvidence = require('./guard_evidence.js');
const SCRIPTS = ['js/levels.js', 'js/engine.js', 'js/render.js', 'js/audio.js', 'js/main.js'];

let failures = 0;
let total = 0;
function record(name, ok, detail) {
  total++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---------------- 通用沙箱 ---------------- */
function makeCtx2d() {
  const noop = function () {};
  const c = {};
  ('clearRect fillRect strokeRect beginPath closePath moveTo lineTo arc arcTo rect ellipse ' +
    'fillText strokeText quadraticCurveTo bezierCurveTo fill stroke save restore translate ' +
    'rotate scale setTransform setLineDash drawImage createImageData putImageData clip isPointInPath')
    .split(' ').forEach(m => { c[m] = noop; });
  c.createLinearGradient = () => ({ addColorStop: noop });
  c.createRadialGradient = () => ({ addColorStop: noop });
  c.measureText = () => ({ width: 12 });
  return c;
}

function makeEl(tag, id, env) {
  const listeners = {};
  const el = {
    tagName: tag || 'DIV', id: id || ('el' + (env.seq++)),
    textContent: '', innerHTML: '', style: {}, scrollTop: 0,
    width: 640, height: 420,
    classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; }, contains(c) { return !!this._s[c]; }, toggle() {} },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    getAttribute(k) { return this['_attr_' + k] === undefined ? null : this['_attr_' + k]; },
    setAttribute(k, v) { this['_attr_' + k] = v; },
    getBoundingClientRect() { return { width: env.vw, height: env.vh, left: 0, top: 0 }; },
    getContext() { return env.ctx2d; },
    querySelectorAll(sel) { return env.doc.querySelectorAll(sel); },
    querySelector(sel) { return env.doc.querySelectorAll(sel)[0] || makeEl('DIV', null, env); },
    click() { if (this.onclick) this.onclick(); },
    onclick: null, _listeners: listeners
  };
  return el;
}

/**
 * 建立一个独立的浏览器-like 沙箱并加载前端脚本。
 * opts.scripts 可只加载引擎 + 渲染（不含 main.js），用于渲染坐标断言。
 */
function createEnv(opts) {
  opts = opts || {};
  const vw = opts.vw || 893, vh = opts.vh || 420;
  const env = { seq: 0, vw, vh, ctx2d: makeCtx2d(), now: 1000, raf: [], keys: { keydown: [], keyup: [] }, store: {}, timers: [], errors: [] };
  const elements = new Map();
  const padButtons = ['U', 'L', 'W', 'R', 'D'].map(a => {
    const b = makeEl('BUTTON', 'pad-' + a, env);
    b.getAttribute = k => (k === 'data-act' ? a : null);
    return b;
  });

  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl('DIV', id, env));
      return elements.get(id);
    },
    querySelectorAll(sel) {
      if (sel === '.pad-btn') return padButtons;
      if (sel === '.level-card') {
        const html = this.getElementById('overlay').innerHTML || '';
        const ids = []; const re = /data-i="(\d+)"/g; let m;
        while ((m = re.exec(html))) ids.push(m[1]);
        return ids.map(i => {
          const key = 'card' + i;
          if (!elements.has(key)) {
            const el = makeEl('BUTTON', key, env);
            el.getAttribute = k => (k === 'data-i' ? i : null);
            elements.set(key, el);
          }
          return elements.get(key);
        });
      }
      return [];
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || makeEl('DIV', null, env); },
    addEventListener(t, fn) { if (t === 'keydown') env.keys.keydown.push(fn); else if (t === 'keyup') env.keys.keyup.push(fn); },
    body: makeEl('BODY', 'body', env)
  };
  env.doc = doc;

  const sandbox = {
    document: doc,
    localStorage: {
      getItem: k => (k in env.store ? env.store[k] : null),
      setItem: (k, v) => { env.store[k] = String(v); },
      removeItem: k => { delete env.store[k]; }
    },
    devicePixelRatio: opts.dpr || 1,
    performance: { now: () => env.now },
    requestAnimationFrame(cb) { env.raf.push(cb); return env.raf.length; },
    cancelAnimationFrame() {},
    addEventListener(t, fn) { if (t === 'keydown') env.keys.keydown.push(fn); else if (t === 'keyup') env.keys.keyup.push(fn); },
    setTimeout(fn, ms) { env.timers.push({ fn, at: env.now + (ms || 0) }); return env.timers.length; },
    clearTimeout() {},
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map, RegExp,
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0, sampleRate: 44100, destination: {}, resume() {},
        createOscillator: () => ({ type: 'sine', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
        createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 }, connect() {} }),
        createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
        createBufferSource: () => ({ buffer: null, connect() {}, start() {} })
      };
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (opts.seed) opts.seed(env);           // 在脚本加载前预置 localStorage 等状态
  const scripts = opts.scripts || SCRIPTS;
  for (const s of scripts) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), sandbox, { filename: s }); }
    catch (e) { env.errors.push(s + ': ' + e.message); }
  }
  env.sandbox = sandbox;
  env.Engine = sandbox.EchoEngine;
  env.LEVELS = sandbox.EchoLevels;
  env.R = sandbox.EchoRender;
  env.fireKey = function (type, code) {
    const ev = { code, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false };
    (env.keys[type] || []).forEach(fn => fn(ev));
  };
  /** 推进 n 帧（每帧 16.7ms 虚拟时间），并触发到期的虚拟定时器 */
  env.frames = function (n) {
    for (let i = 0; i < n; i++) {
      const q = env.raf; env.raf = [];
      env.now += 16.7;
      q.forEach(cb => { try { cb(env.now); } catch (e) { env.errors.push('frame: ' + e.message); } });
      const due = env.timers.filter(t => t.at <= env.now);
      env.timers = env.timers.filter(t => t.at > env.now);
      due.forEach(t => { try { t.fn(); } catch (e) { env.errors.push('timer: ' + e.message); } });
    }
  };
  env.el = id => doc.getElementById(id);
  return env;
}

/* =========================================================
 * R1 渲染坐标一致性（A0）
 * 失败条件：实体纵坐标使用 ox 计算，而地格使用 oy；
 *           ox !== oy 时实体中心与地格中心相差 ox-oy。
 * ========================================================= */
function R1() {
  console.log('\n[R1] 显示/逻辑坐标一致性（A0）');
  const e = createEnv({ scripts: ['js/levels.js', 'js/engine.js', 'js/render.js'], vw: 893, vh: 420, dpr: 1 });
  if (e.errors.length) { record('R1 脚本加载', false, e.errors.join('; ')); return; }
  const st = e.Engine.create(e.LEVELS[2]);   // 第 3 关，13x9
  try { e.R.init(e.el('game')); e.R.draw(st, 0.016); } catch (err) { record('R1 渲染', false, err.message); return; }
  const m = e.R.metrics();
  const gx = 3, gy = 6;
  const correctX = m.ox + gx * m.cell + m.cell / 2;
  const correctY = m.oy + gy * m.cell + m.cell / 2;
  const legacyY = m.ox + gy * m.cell + m.cell / 2;   // 旧 px(y) 的结果
  const drift = legacyY - correctY;                  // = ox - oy
  console.log(`     viewport=893x420 cell=${m.cell} ox=${m.ox} oy=${m.oy} 旧公式纵向漂移=${drift}px`);
  record('R1a 非正方形画布确实产生 ox≠oy（失败条件成立）', Math.abs(drift) > 1, `ox-oy=${m.ox - m.oy}px`);
  if (typeof e.R.gridToScreen !== 'function') {
    record('R1b 渲染层导出 gridToScreen(x,y)', false, '未导出（旧版只有 px(gx)，无法区分 x/y）');
    return;
  }
  const p = e.R.gridToScreen(gx, gy);
  record('R1b 格中心 x 一致（≤1 CSS px）', Math.abs(p.x - correctX) <= 1, `${p.x} vs ${correctX}`);
  record('R1c 格中心 y 一致（≤1 CSS px）', Math.abs(p.y - correctY) <= 1, `${p.y} vs ${correctY}`);
  if (typeof e.R.diagnostics === 'function') {
    const d = e.R.diagnostics(st);
    record('R1d 稳定帧实体绘制中心与逻辑格中心一致', d.ok, d.detail);
  } else {
    record('R1d 渲染坐标断言接口 diagnostics()', false, '未导出');
  }
}

/* =========================================================
 * R2 演示与正式存档隔离（A1）
 * ========================================================= */
function R2() {
  console.log('\n[R2] 参考解演示不得污染正式纪录（A1）');
  const e = createEnv();
  if (e.errors.length) { record('R2 脚本加载', false, e.errors.join('; ')); return; }
  const before = e.sandbox.localStorage.getItem('echo.progress');
  e.el('p-start').click();
  e.fireKey('keydown', 'KeyH'); e.fireKey('keyup', 'KeyH');
  e.frames(320);                       // 12 步 × 150ms + 启动延时
  const after = e.sandbox.localStorage.getItem('echo.progress');
  record('R2a 演示结束后 localStorage 未写入正式纪录', before === after,
    `before=${before} after=${after}`);
  const html = e.el('overlay').innerHTML || '';
  record('R2b 演示结束显示「演示完成」状态面板', html.indexOf('演示完成') >= 0,
    html.indexOf('演示完成') >= 0 ? '' : '仍进入正式结算面板');

  // 手动通关仍应写入
  e.el('p-restart') && e.el('p-restart').click();
  e.fireKey('keydown', 'KeyR'); e.fireKey('keyup', 'KeyR');
  const lv = e.LEVELS[0];
  const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };
  for (const ch of lv.solution) { e.fireKey('keydown', CODE[ch]); e.fireKey('keyup', CODE[ch]); e.frames(1); }
  e.frames(60);                        // 触发 onWin 的结算延时
  const saved = JSON.parse(e.sandbox.localStorage.getItem('echo.progress') || '{}');
  const lvRec = (saved.levels || saved)[lv.id];   // schema 2 嵌套在 levels；兼容旧结构
  record('R2c 手动通关仍按规则写入正式纪录', !!(lvRec && lvRec.done),
    JSON.stringify(saved).slice(0, 160));
}

/* =========================================================
 * R3 教程规则文案与 echoEvery 实值一致（A2）
 * ========================================================= */
function R3() {
  console.log('\n[R3] 教程文案与关卡 T 实值一致（A2）');
  const e = createEnv();
  if (e.errors.length) { record('R3 脚本加载', false, e.errors.join('; ')); return; }
  const html = e.el('overlay').innerHTML || '';
  const Ts = [...new Set(e.LEVELS.map(l => l.echoEvery))].sort();
  const firstT = e.LEVELS[0].echoEvery;
  const restT = [...new Set(e.LEVELS.slice(1).map(l => l.echoEvery))];
  console.log(`     实际 T 集合=${Ts.join(',')} 第1关=${firstT} 其余=${restT.join(',')}`);
  record('R3a 教程明确写出第 1 关的 T', html.indexOf(String(firstT) + ' 拍') >= 0,
    `期望含 "${firstT} 拍"`);
  record('R3b 教程明确写出其余关卡的 T', restT.every(t => html.indexOf(String(t) + ' 拍') >= 0),
    `期望含 ${restT.map(t => t + ' 拍').join(' / ')}`);
  record('R3c 未把单一 T 值宣称为全局规则', !/每当走过\s*<b>\s*4\s*拍/.test(html) && html.indexOf('每 4 拍诞生') < 0,
    '旧版标题只写 LEVELS[1].echoEvery=4');
  // 每关 hint 与自身 T 无矛盾（不得出现「每 4 拍」却该关 T=6）
  const bad = e.LEVELS.filter(l => /每\s*\d+\s*拍/.test(l.hint || '') && !l.hint.includes(String(l.echoEvery) + ' 拍'));
  record('R3d 关卡提示文案不引用错误的 T 值', bad.length === 0,
    bad.length ? bad.map(l => l.id).join(',') : '');
}

/* =========================================================
 * R4 撤销 >400 步完整回放（A3）
 * ========================================================= */
function R4() {
  console.log('\n[R4] 超过 400 步的完整本局撤销（A3）');
  const e = createEnv();
  if (e.errors.length) { record('R4 脚本加载', false, e.errors.join('; ')); return; }
  e.el('p-start').click();
  const N = 450;
  for (let i = 0; i < N; i++) { e.fireKey('keydown', 'Space'); e.fireKey('keyup', 'Space'); }
  e.frames(2);
  const mid = e.el('stat-steps').textContent;
  for (let i = 0; i < N; i++) { e.fireKey('keydown', 'KeyZ'); e.fireKey('keyup', 'KeyZ'); }
  e.frames(2);
  const steps = e.el('stat-steps').textContent;
  const echoes = e.el('stat-echoes').textContent;
  record('R4a 连续 450 拍后 HUD 步数为 450', String(mid) === '450', `实际 ${mid}`);
  record('R4b 撤销 450 次后回到第 0 拍（旧版 400 上限会残留 50）', String(steps) === '0', `实际 ${steps}`);
  record('R4c 撤销后场上残像归零', String(echoes).indexOf('0/') === 0, `实际 ${echoes}`);
}

/* =========================================================
 * R5 时间锚机制（B1）—— 修复/新增后才有意义
 * ========================================================= */
function R5() {
  console.log('\n[R5] 时间锚机制：确定性、覆盖、阻挡、撤销、解题必要性（B1）');
  const anchorLv = LEVELS.find(l => l.map.join('').indexOf('^') >= 0);
  if (!anchorLv) { record('R5 存在含时间锚的关卡', false, '第二轮待新增'); return; }
  const st0 = Engine.getStatic(anchorLv);
  const anchors = [];
  for (let y = 0; y < st0.rows; y++) for (let x = 0; x < st0.cols; x++) if (st0.tiles[y][x].anchor) anchors.push({ x, y });
  record('R5a 地图解析出锚点格', anchors.length > 0, `共 ${anchors.length} 个`);
  const s = Engine.create(anchorLv);
  record('R5b 开局 anchor 记录为空', s.anchor === null, JSON.stringify(s.anchor));

  // 回放参考解，观察踩锚与锚生效
  let setCount = 0, appliedCount = 0, ignoredCount = 0, sawAnchorEcho = false;
  const snap = Engine.clone(s);
  for (const ch of anchorLv.solution) {
    const r = Engine.applyAction(s, ch);
    for (const ev of r.events) {
      if (ev.type === 'anchorSet') setCount++;
      if (ev.type === 'anchorApplied') appliedCount++;
      if (ev.type === 'anchorIgnored') ignoredCount++;
    }
    if (s.echoes.some(x => x.fromAnchor)) sawAnchorEcho = true;
  }
  record('R5c 参考解过程中确实踩下锚点', setCount > 0, `anchorSet × ${setCount}`);
  record('R5d 锚点确实改写了新回响的起点', appliedCount > 0 && sawAnchorEcho,
    `anchorApplied × ${appliedCount} / anchorIgnored × ${ignoredCount}`);
  record('R5e 参考解通关', s.status === 'won', `status=${s.status} step=${s.step}`);

  // 解题必要性：把锚点字符替换为普通地板，同一串动作不得通关
  const noAnchor = Object.assign({}, anchorLv, { map: anchorLv.map.map(r => r.replace(/\^/g, '.')) });
  const s2 = Engine.create(noAnchor);
  for (const ch of anchorLv.solution) { Engine.applyAction(s2, ch); if (s2.status !== 'playing') break; }
  record('R5f 去掉锚点后同一参考解不再通关（机制为必要条件）', s2.status !== 'won',
    `无锚版本 status=${s2.status} step=${s2.step}`);

  // 撤销/快照：clone 与后续状态互不污染
  record('R5g 快照中的 anchor 独立可回滚', JSON.stringify(snap.anchor) === 'null' && s.anchor !== undefined,
    'clone 保留 anchor 字段');

  // 覆盖语义：连踩两次锚，记录应为最后一次
  const s3 = Engine.create(anchorLv);
  let lastSet = null;
  for (const ch of anchorLv.solution) {
    const r = Engine.applyAction(s3, ch);
    const ev = r.events.find(x => x.type === 'anchorSet');
    if (ev) lastSet = { x: ev.x, y: ev.y, step: s3.step };
  }
  if (lastSet) {
    record('R5h 锚点记录含位置与拍数（可确定性重播）',
      typeof lastSet.x === 'number' && typeof lastSet.step === 'number', JSON.stringify(lastSet));
  } else record('R5h 锚点记录含位置与拍数', false, '未捕获 anchorSet');
}

/* =========================================================
 * R6 暂停/恢复 + 重复结算 + 连续重开（稳定性）
 * ========================================================= */
function R6() {
  console.log('\n[R6] 暂停恢复、重复结算、连续重开（稳定性）');
  const e = createEnv();
  if (e.errors.length) { record('R6 脚本加载', false, e.errors.join('; ')); return; }
  e.el('p-start').click();
  e.fireKey('keydown', 'ArrowRight'); e.fireKey('keyup', 'ArrowRight'); e.frames(1);
  const before = e.el('stat-steps').textContent;
  e.fireKey('keydown', 'KeyP'); e.fireKey('keyup', 'KeyP'); e.frames(2);
  const pausedHtml = e.el('overlay').innerHTML || '';
  e.fireKey('keydown', 'ArrowRight'); e.fireKey('keyup', 'ArrowRight'); e.frames(2);
  const frozen = e.el('stat-steps').textContent;
  e.fireKey('keydown', 'KeyP'); e.fireKey('keyup', 'KeyP'); e.frames(2);
  e.fireKey('keydown', 'ArrowRight'); e.fireKey('keyup', 'ArrowRight'); e.frames(2);
  const resumed = e.el('stat-steps').textContent;
  record('R6a 按 P 出现暂停面板', pausedHtml.indexOf('暂停') >= 0, '');
  record('R6b 暂停时输入被忽略', String(frozen) === String(before), `${before} → ${frozen}`);
  record('R6c 恢复后输入继续生效', Number(resumed) === Number(before) + 1, `${before} → ${resumed}`);

  // 连续重开 10 次
  let ok = true;
  for (let i = 0; i < 10; i++) {
    e.fireKey('keydown', 'KeyR'); e.fireKey('keyup', 'KeyR'); e.frames(2);
    if (String(e.el('stat-steps').textContent) !== '0') { ok = false; break; }
  }
  record('R6d 连续重开 10 次均回到第 0 拍', ok, '');

  // 通关后重复输入不得重复结算 / 不改写最佳纪录
  const lv = e.LEVELS[0];
  const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };
  for (const ch of lv.solution) { e.fireKey('keydown', CODE[ch]); e.fireKey('keyup', CODE[ch]); e.frames(1); }
  e.frames(60);
  const rec1 = JSON.stringify(JSON.parse(e.sandbox.localStorage.getItem('echo.progress') || '{}'));
  for (let i = 0; i < 8; i++) { e.fireKey('keydown', 'ArrowRight'); e.fireKey('keyup', 'ArrowRight'); e.frames(1); }
  e.frames(60);
  const rec2 = JSON.stringify(JSON.parse(e.sandbox.localStorage.getItem('echo.progress') || '{}'));
  record('R6e 通关后重复输入不产生重复结算', rec1 === rec2, `${rec1} → ${rec2}`);
}

/* =========================================================
 * R7 第 3 关逐步规则回放（A0 证据）：第11步双板、第12步开门、第17步出口
 * ========================================================= */
function R7() {
  console.log('\n[R7] 第 3 关逐步规则回放（A0 画面/逻辑同格证据）');
  const lv = LEVELS[2];
  const s = Engine.create(lv);
  const marks = {};
  for (let i = 0; i < lv.solution.length; i++) {
    // 门在「拍初」求值并冻结整拍，因此判定必须取动作前的门状态
    const doorsBefore = Engine.evaluateDoors(s);
    Engine.applyAction(s, lv.solution[i]);
    const step = s.step;
    if (step === 11) marks[11] = { echoPos: s.echoes.map(e => e.x + ',' + e.y), doors: doorsBefore };
    if (step === 12) marks[12] = { player: s.player.x + ',' + s.player.y, doorsAtBeatStart: doorsBefore };
    if (step === 17) marks[17] = { player: s.player.x + ',' + s.player.y, status: s.status };
  }
  const st0 = Engine.getStatic(lv);
  record('R7a 第 11 步两只回响同时压住两块 a 板',
    !!marks[11] && st0.plates.a.every(p => marks[11].echoPos.indexOf(p.x + ',' + p.y) >= 0),
    JSON.stringify(marks[11]));
  record('R7b 第 12 步拍初 A 门开启且玩家已穿过门',
    !!marks[12] && marks[12].doorsAtBeatStart.A === true && marks[12].player === '7,6',
    JSON.stringify(marks[12]));
  record('R7c 第 17 步玩家位于真实出口并判胜',
    !!marks[17] && marks[17].status === 'won' && marks[17].player === st0.exit.x + ',' + st0.exit.y,
    JSON.stringify(marks[17]));
}

/* =========================================================
 * R8 时间望远镜（第三轮核心升级）：预测与实际一致、不改真实状态、UI 接线
 * ========================================================= */
function R8() {
  console.log('\n[R8] 时间望远镜：确定性预测（第三轮核心升级）');
  const lv = LEVELS.find(l => l.id === 13);
  record('R8a 存在望远镜教学关（第 13 关）', !!lv, lv ? lv.name : '缺失');

  // 预测不改真实状态
  const s = Engine.create(lv);
  ['D', 'R', 'R', 'D', 'D'].forEach(a => Engine.applyAction(s, a));
  const before = JSON.stringify(s);
  const pr = Engine.predict(s);
  record('R8b predict() 不修改真实状态', JSON.stringify(s) === before, '');

  // 预测的下一只残像出生点 = 引擎下一次诞生逻辑使用的 history[step-T]
  const nextSpawnStep = (Math.floor(s.step / lv.echoEvery) + 1) * lv.echoEvery;
  const expectedBirth = s.history[nextSpawnStep - lv.echoEvery];
  record('R8c 预测的下一只残像出生点与引擎诞生公式一致',
    pr.nextEcho && pr.nextEcho.from.x === expectedBirth.x && pr.nextEcho.from.y === expectedBirth.y,
    `predict=${pr.nextEcho && JSON.stringify(pr.nextEcho.from)} engine=${JSON.stringify(expectedBirth)}`);

  // 预测的冻结点 = 随后实际等待时发生的 echoFroze 事件
  const predicted = {};
  pr.echoFutures.forEach(f => { if (f.freeze) predicted[f.id] = f.freeze.x + ',' + f.freeze.y; });
  const actual = {};
  let guard = 0;
  while (s.status === 'playing' && guard++ < 40) {
    const r = Engine.applyAction(s, 'W');
    for (const ev of r.events) if (ev.type === 'echoFroze') actual[ev.id] = ev.x + ',' + ev.y;
    if (Object.keys(predicted).every(id => id in actual)) break;
  }
  const ids = Object.keys(predicted);
  record('R8d 预测冻结点与实际 echoFroze 逐格一致（含 id）',
    ids.length > 0 && ids.every(id => predicted[id] === actual[id]),
    JSON.stringify({ predicted, actual }));

  // UI 接线：V 消耗一拍且预演随后被新动作清除；撤销回滚
  const e = createEnv();
  if (e.errors.length) { record('R8e 前端脚本加载', false, e.errors.join('; ')); }
  else {
    e.el('p-start').click();
    e.fireKey('keydown', 'ArrowRight'); e.fireKey('keyup', 'ArrowRight'); e.frames(1);
    const beforeSteps = e.el('stat-steps').textContent;
    e.fireKey('keydown', 'KeyV'); e.fireKey('keyup', 'KeyV'); e.frames(1);
    const afterSteps = e.el('stat-steps').textContent;
    record('R8f 按 V 消耗一拍（预演=等待的代价）', Number(afterSteps) === Number(beforeSteps) + 1,
      `${beforeSteps} → ${afterSteps}`);
    e.fireKey('keydown', 'KeyZ'); e.fireKey('keyup', 'KeyZ'); e.frames(1);
    record('R8g 预演可撤销回一拍', String(e.el('stat-steps').textContent) === String(beforeSteps),
      `实际 ${e.el('stat-steps').textContent}`);
  }
}

/* =========================================================
 * R9 存档可靠性（A6）：schema/校验和/旧档迁移/坏档回退
 * ========================================================= */
function R9() {
  console.log('\n[R9] 存档 schema、校验和、旧档迁移与坏档回退（A6）');

  // ① 新档格式：schema 2 + 校验和
  {
    const e = createEnv();
    if (e.errors.length) record('R9a 脚本加载', false, e.errors.join('; '));
    else {
      e.el('p-start').click();
      const lv = e.LEVELS[0];
      const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };
      for (const ch of lv.solution) { e.fireKey('keydown', CODE[ch]); e.fireKey('keyup', CODE[ch]); e.frames(1); }
      e.frames(60);
      const saved = JSON.parse(e.sandbox.localStorage.getItem('echo.progress'));
      record('R9a 新档带 schema 版本号', saved.schema === 2, `schema=${saved.schema}`);
      record('R9b 新档带校验和字段', typeof saved.checksum === 'string' && saved.checksum.length > 0, saved.checksum);
      record('R9c 通关纪录仍在 levels 内', !!(saved.levels && saved.levels[lv.id] && saved.levels[lv.id].done), '');
    }
  }

  // ② 旧档迁移：第一/二轮的裸 levels 映射不丢数据
  {
    const oldSave = JSON.stringify({ 1: { stars: 2, steps: 12, done: true }, 2: { stars: 1, steps: 15, done: true } });
    const e = createEnv({ seed: env => { env.store['echo.progress'] = oldSave; } });
    if (e.errors.length) record('R9d 旧档迁移加载', false, e.errors.join('; '));
    else {
      e.el('p-select') ? null : null;
      // 打开关卡列表，检查第 1/2 关有纪录且第 3 关解锁
      const btn = e.doc.querySelectorAll('#p-select')[0];
      e.el('p-select').click(); e.frames(1);
      const html = e.el('overlay').innerHTML || '';
      const lockedCount = (html.match(/locked/g) || []).length;
      // 旧档标 L1、L2 已通 → L1/L2/L3 解锁（unlocked(i) 看上一关），其余 12 关锁定（15 关版本）
      record('R9d 旧档迁移后纪录保留（第 1 关显示 ★★☆，锁定数=12）',
        html.indexOf('★★☆') >= 0 && lockedCount === e.LEVELS.length - 3,
        `locked=${lockedCount}/${e.LEVELS.length}`);
      // 通关一次后写回 schema 2，且旧纪录保留：经关卡列表点第 1 关卡片
      e.el('p-back').click(); e.frames(1);
      e.el('p-select').click(); e.frames(1);
      e.doc.querySelectorAll('.level-card')[0].click(); e.frames(1);
      const lv = e.LEVELS[0];
      const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };
      for (const ch of lv.solution) { e.fireKey('keydown', CODE[ch]); e.fireKey('keyup', CODE[ch]); e.frames(1); }
      e.frames(60);
      const saved = JSON.parse(e.sandbox.localStorage.getItem('echo.progress'));
      record('R9e 写回后升级为 schema 2 且旧纪录无丢失',
        saved.schema === 2 && saved.levels[1] && saved.levels[1].done && saved.levels[2] && saved.levels[2].done,
        JSON.stringify(Object.keys(saved.levels || {})));
    }
  }

  // ③ 坏档：解析失败 → 备份坏档、从空白开始、游戏仍可玩
  {
    const bad = '{broken json!!';
    const e = createEnv({ seed: env => { env.store['echo.progress'] = bad; } });
    if (e.errors.length) record('R9f 坏档加载', false, e.errors.join('; '));
    else {
      record('R9f 坏档被备份到 echo.progress.corrupt，原键不被静默清除',
        e.sandbox.localStorage.getItem('echo.progress.corrupt') === bad,
        String(e.sandbox.localStorage.getItem('echo.progress.corrupt')));
      e.el('p-start').click();
      const steps = e.el('stat-steps').textContent;
      record('R9g 坏档后游戏仍可正常开始（第 0 拍）', String(steps) === '0', `实际 ${steps}`);
      // 新纪录可正常写入（覆盖坏键）
      const lv = e.LEVELS[0];
      const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };
      for (const ch of lv.solution) { e.fireKey('keydown', CODE[ch]); e.fireKey('keyup', CODE[ch]); e.frames(1); }
      e.frames(60);
      const saved = JSON.parse(e.sandbox.localStorage.getItem('echo.progress'));
      record('R9h 坏档后新存档可正常写入', saved.schema === 2 && saved.levels[lv.id].done, '');
    }
  }

  // ④ 校验和不符（篡改）→ 与坏档同等处理
  {
    const forged = JSON.stringify({ schema: 2, checksum: 'nope', levels: { 1: { stars: 3, steps: 9, done: true } }, settings: {} });
    const e = createEnv({ seed: env => { env.store['echo.progress'] = forged; } });
    record('R9i 篡改的存档（校验和不符）被拒绝并备份',
      e.sandbox.localStorage.getItem('echo.progress.corrupt') === forged,
      String(e.sandbox.localStorage.getItem('echo.progress.corrupt')).slice(0, 40));
  }
}

/* ---------------------------------------------------------
 * R10：关卡机关必要性（用户反馈「8–14 关直接走过去就行」的回归防线）
 * 保留修复前由 tools/audit-before.log 记录的绕行路径作为失败条件。
 * --------------------------------------------------------- */
function R10() {
  console.log('\n[R10] 机关必要性 / 割集 / 教学点');

  // R10a：逐关审计
  const bad = [];
  for (const lv of LEVELS) {
    const r = audit.auditLevel(lv);
    if (!r.pass) bad.push(`L${lv.id}(${r.gPass ? 'G✓' : 'G✗'}${r.nPass ? 'N✓' : 'N✗'})`);
  }
  record('R10a 全部关卡：门为几何割集且禁用回响后无法通关',
    bad.length === 0, bad.length ? bad.join(' ') : `${LEVELS.length} 关全通过`);

  // R10b：修复前真实绕行路径，现在必须走不通
  const BYPASS = {
    2: 'RRRRRRDRRRUR',
    8: 'DRRRRRRRDRR',
    9: 'DRRRRRRRDRR',
    10: 'RDRRRRRRDRR',
    11: 'DRRRRRRRDRR',
    12: 'RRDRRRRRDRR',
    13: 'DDDRRRRRRRRRR',
    14: 'DDDRRRRRRDDRRRR',
    15: 'UDDRRDRDRDD'
  };
  for (const id of Object.keys(BYPASS)) {
    const lv = LEVELS.find(l => l.id === Number(id));
    const s = Engine.create(lv);
    for (const ch of BYPASS[id]) { Engine.applyAction(s, ch); if (s.status !== 'playing') break; }
    record(`R10b L${id} 修复前「直接走过去」路径现无法通关`,
      s.status !== 'won', `终态 ${s.status}，第 ${s.step} 拍`);
  }

  // R10c：L9 覆盖的几何硬约束（锚1 超出回响重演长度，锚2 才可送达）
  const l9 = LEVELS.find(l => l.id === 9);
  const st9 = Engine.getStatic(l9);
  const anchors = [];
  st9.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.anchor) anchors.push({ x, y }); }));
  const plate9 = st9.plates.a[0];
  const dist = a => Math.abs(a.x - plate9.x) + Math.abs(a.y - plate9.y);
  record('R10c L9 双锚距离满足「锚1 > T、锚2 ≤ T」（覆盖有可证明的必要性）',
    anchors.length === 2 && dist(anchors[0]) > l9.echoEvery && dist(anchors[1]) <= l9.echoEvery,
    `T=${l9.echoEvery}，板=(${plate9.x},${plate9.y})，距离=${anchors.map(dist).join('/')}`);

  // R10d：L9 参考解确实踩中两个不同锚点（覆盖真实发生，不是摆设）
  const s9 = Engine.create(l9);
  const seen = new Set();
  for (const ch of l9.solution) {
    const r = Engine.applyAction(s9, ch);
    r.events.filter(e => e.type === 'anchorSet').forEach(e => seen.add(e.x + ',' + e.y));
    if (s9.status !== 'playing') break;
  }
  record('R10d L9 参考解踩中两个不同锚点且通关',
    s9.status === 'won' && seen.size === 2, [...seen].join(' / '));

  // R10e：L14 双门双板仍在（防止「双星定位」退化成单门）
  const st14 = Engine.getStatic(LEVELS.find(l => l.id === 14));
  record('R10e L14 保留 A/B 两道门与 a/b 两块独立压力板',
    st14.doors.A.length === 1 && st14.doors.B.length === 1 &&
    st14.plates.a.length === 1 && st14.plates.b.length === 1, '');

  // R10f：L15 出口只留一格咽喉，门关时出口区完全隔绝
  const st15 = Engine.getStatic(LEVELS.find(l => l.id === 15));
  const g15 = audit.geometryBypass(LEVELS.find(l => l.id === 15));
  record('R10f L15 门 A 是出口区唯一入口',
    !g15.reachable && st15.doors.A.length === 1, '');

  /* R10g–R10i：L15 守卫不是装饰（11-07 按玩家反馈加回）。
     三条断言共同锁住「守卫必须真的约束通过时序」：
       g 存在且在门后走廊、割集与机制必要性仍成立；
       h 咽喉前多等一拍：有守卫被抓、无守卫仍能通关；
       i 单点扰动容错：有守卫明显窄于无守卫。 */
  const l15 = LEVELS.find(l => l.id === 15);
  const noGuard = guardEvidence.stripGuards(l15);
  const aG = audit.auditLevel(l15);
  const aN = audit.auditLevel(noGuard);
  const doorA = st15.doors.A[0];
  const throat = { x: doorA.x, y: doorA.y + 1 };
  const guards = st15.guardStart;

  record('R10g L15 保留 1 名门后走廊守卫，且割集 / 机制必要性不受影响',
    guards.length === 1 &&
    guards.every(g => g.y === throat.y && g.x >= throat.x) &&
    aG.pass && aN.pass,
    `守卫=${JSON.stringify(guards)} 咽喉=(${throat.x},${throat.y}) G=${aG.gPass} N=${aG.nPass}`);

  const base = guardEvidence.replay(l15, l15.solution);
  const delayed = l15.solution.slice(0, base.throatAt - 1) + 'W' + l15.solution.slice(base.throatAt - 1);
  const dG = guardEvidence.replay(l15, delayed);
  const dN = guardEvidence.replay(noGuard, delayed);
  record('R10h L15 咽喉前多等一拍：有守卫被抓 / 无守卫仍能通关',
    base.status === 'won' && base.throatAt > 0 &&
    dG.status !== 'won' && dN.status === 'won',
    `咽喉第 ${base.throatAt} 拍；有守卫=${dG.status} 无守卫=${dN.status}`);

  const wG = guardEvidence.perturbationWidth(l15, l15.solution);
  const wN = guardEvidence.perturbationWidth(noGuard, l15.solution);
  const nG = wG.insert + wG.remove, nN = wN.insert + wN.remove;
  record('R10i L15 守卫显著收窄可行时序（单点扰动容错）',
    nG > 0 && nN > nG,
    `${wG.total} 条扰动：有守卫 ${nG} 条可通关 / 无守卫 ${nN} 条`);
}

/* ========================================================= */
(async function main() {
  console.log('\n=== 《回响》第二轮回归测试（regress.js） ===');
  console.log('版本：Round3 baseline | 关卡数：' + LEVELS.length + '\n');
  R1(); R2(); R3(); R4(); R5(); R6(); R7(); R8(); R9(); R10();
  console.log(`\n结果：${total - failures}/${total} 通过，${failures} 项失败\n`);
  if (failures) process.exit(1);
})();
