/* =========================================================
 * tools/smoke.js —— 无头冒烟测试
 *
 * 用一套最小 DOM / Canvas 替身，在 Node 里真实加载 index.html 的
 * 全部 JS（含渲染层与主流程），然后：
 *   1. 检查所有脚本能无异常加载
 *   2. 连续渲染 60 帧，确认渲染层无异常
 *   3. 模拟键盘按键，逐关回放内置参考解，确认真的能走到通关闭环
 *
 * 用法：node tools/smoke.js
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------- Canvas 2D 替身 ---------------- */
function makeCtx() {
  const noop = function () {};
  const ctx = {};
  ('clearRect fillRect strokeRect beginPath closePath moveTo lineTo arc arcTo rect ellipse ' +
    'fillText strokeText quadraticCurveTo bezierCurveTo fill stroke save restore translate ' +
    'rotate scale setTransform setLineDash drawImage createImageData putImageData clip isPointInPath')
    .split(' ').forEach(m => { ctx[m] = noop; });
  ctx.createLinearGradient = () => ({ addColorStop: noop });
  ctx.createRadialGradient = () => ({ addColorStop: noop });
  ctx.measureText = () => ({ width: 12 });
  return ctx;
}

/* ---------------- DOM 替身 ---------------- */
let rafQueue = [];
let idSeq = 0;

function makeEl(tag, id) {
  const listeners = {};
  const el = {
    tagName: tag || 'DIV',
    id: id || ('el' + (idSeq++)),
    textContent: '',
    innerHTML: '',
    style: {},
    scrollTop: 0,
    width: 640,
    height: 420,
    classList: {
      add() {}, remove() {}, contains() { return false; }, toggle() {}
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    getAttribute() { return null; },
    setAttribute(k, v) { this['_' + k] = v; },
    getBoundingClientRect() { return { width: 640, height: 420, left: 0, top: 0 }; },
    getContext() { this._ctx = this._ctx || makeCtx(); return this._ctx; },
    querySelectorAll(sel) { return documentStub.querySelectorAll(sel); },
    onclick: null,
    _listeners: listeners,
    click() { if (this.onclick) this.onclick(); }
  };
  return el;
}

const elements = new Map();
const cardCache = new Map();
const padButtons = ['U', 'L', 'W', 'R', 'D'].map(act => {
  const b = makeEl('BUTTON', 'pad-' + act);
  b.getAttribute = () => act;
  return b;
});

const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl('DIV', id));
    return elements.get(id);
  },
  querySelectorAll(sel) {
    if (sel === '.pad-btn') return padButtons;
    if (sel === '.level-card') {
      // 从面板 HTML 里解析出关卡卡片，返回可持有 onclick 的替身元素
      const html = documentStub.getElementById('overlay').innerHTML || '';
      const ids = [];
      const re = /data-i="(\d+)"/g;
      let m;
      while ((m = re.exec(html))) ids.push(m[1]);
      return ids.map(i => {
        if (!cardCache.has(i)) {
          const el = makeEl('BUTTON', 'lvc' + i);
          el.getAttribute = () => i;
          cardCache.set(i, el);
        }
        return cardCache.get(i);
      });
    }
    return [];
  },
  querySelector(sel) { return documentStub.querySelectorAll(sel)[0] || makeEl('DIV'); },
  addEventListener(type, fn) {
    // 键盘事件统一收集，供 fireKey 派发
    if (type === 'keydown') keyHandlers.keydown.push(fn);
    else if (type === 'keyup') keyHandlers.keyup.push(fn);
    (this._l = this._l || {})[type] = (this._l[type] || []).concat(fn);
  },
  body: makeEl('BODY')
};

const keyHandlers = { keydown: [], keyup: [] };
globalThis.document = documentStub;
globalThis.window = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.addEventListener = function (type, fn) {
  if (type === 'keydown') keyHandlers.keydown.push(fn);
  else if (type === 'keyup') keyHandlers.keyup.push(fn);
};
globalThis.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = function () {};
// 可控时钟：main.js 的演示节拍与帧循环都读 performance.now()，
// 用虚拟时钟才能在无头环境里把演示真正跑完（而不是只跑第一帧）
let clock = 1000;
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => clock }, configurable: true, writable: true
});

const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

let audioNodeCount = 0;
class FakeAudioParam {
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
}
globalThis.AudioContext = function () {
  audioNodeCount++;
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume() {},
    createOscillator: () => ({ type: 'sine', frequency: new FakeAudioParam(), connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: new FakeAudioParam(), connect() {} }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ buffer: null, connect() {}, start() {} })
  };
};

function fireKey(type, code) {
  const ev = { code, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false };
  (keyHandlers[type] || []).forEach(fn => fn(ev));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- 加载全部脚本 ---------------- */
const root = path.join(__dirname, '..');
const scripts = ['js/levels.js', 'js/engine.js', 'js/render.js', 'js/audio.js', 'js/main.js'];

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); } else { failures++; console.log('  ✗ ' + msg); }
}

(async function run() {
  console.log('\n=== 《回响》无头冒烟测试 ===');

  for (const s of scripts) {
    try {
      vm.runInThisContext(fs.readFileSync(path.join(root, s), 'utf8'), { filename: s });
      console.log('  ✓ 加载 ' + s);
    } catch (e) {
      failures++;
      console.log('  ✗ 加载 ' + s + ' 失败：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
    }
  }
  const Engine = globalThis.EchoEngine;
  const LEVELS = globalThis.EchoLevels;
  const R = globalThis.EchoRender;
  if (!Engine || !LEVELS || !R) { console.log('\n✗ 全局对象未正确挂载\n'); process.exit(1); }
  console.log(`版本：ECHO Round3 | 关卡数：${LEVELS.length}\n`);

  // 跑帧
  function frames(n) {
    for (let i = 0; i < n; i++) {
      const q = rafQueue; rafQueue = [];
      clock += 16.7;
      q.forEach(cb => cb(clock));
    }
  }
  try {
    frames(60);
    assert(true, '连续渲染 60 帧无异常');
  } catch (e) {
    assert(false, '渲染帧异常：' + e.message);
  }

  // 标题界面的按钮
  const startBtn = documentStub.getElementById('p-start');
  assert(!!startBtn.onclick, '标题界面「开始游戏」按钮已绑定');

  const selectBtn = documentStub.getElementById('p-select');
  assert(!!selectBtn.onclick, '标题界面「选择关卡」按钮已绑定');
  selectBtn.click();

  // 选择关卡面板会生成卡片，断言数量与关卡数一致
  frames(2);
  const cards = documentStub.querySelectorAll('.level-card');
  assert(cards.length === LEVELS.length, `关卡面板渲染出 ${LEVELS.length} 张卡片（实际 ${cards.length}）`);

  const CODE = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: 'Space' };

  for (let i = 0; i < LEVELS.length; i++) {
    const lv = LEVELS[i];
    if (!lv.solution) { assert(false, `第 ${lv.id} 关《${lv.name}》缺少参考解`); continue; }

    // 通过“关卡选择”面板进入该关（面板卡片此时是上一次的列表，改用重复调用 startLevel 不可达，
    // 因此这里直接复用当前局面：先点关卡面板 -> 关卡列表按钮 -> 选卡）
    selectBtn.click();
    const list = documentStub.querySelectorAll('.level-card');
    // main.js 会给每张卡片写入 getAttribute('data-i')，替身需要支持
    const card = list[i];
    if (card && card.onclick) card.onclick();

    // 逐键回放参考解
    let ok = true;
    for (const ch of lv.solution) {
      fireKey('keydown', CODE[ch]);
      fireKey('keyup', CODE[ch]);
      frames(1);
    }
    await sleep(900);
    frames(6);

    const overlay = documentStub.getElementById('overlay');
    const html = overlay.innerHTML || '';
    const won = html.indexOf('通关') >= 0 || html.indexOf('全部关卡完成') >= 0;
    const steps = documentStub.getElementById('stat-steps').textContent;
    if (won) {
      console.log(`  ✓ 第 ${lv.id} 关《${lv.name}》按键回放通关（${steps} 步 / par ${lv.par}）`);
    } else {
      failures++;
      console.log(`  ✗ 第 ${lv.id} 关《${lv.name}》按键回放后未出现通关面板（HUD 步数=${steps}）`);
    }
  }

  // 撤销 / 重来
  try {
    fireKey('keydown', 'KeyZ'); frames(2);
    fireKey('keydown', 'KeyR'); frames(2);
    fireKey('keydown', 'ArrowRight'); fireKey('keyup', 'ArrowRight'); frames(4);
    fireKey('keydown', 'Escape'); frames(2);
    assert(true, '撤销 / 重来 / 返回关卡面板 均无异常');
  } catch (e) {
    assert(false, '控制流异常：' + e.message);
  }

  // 参考解演示隔离（A1/B3）：演示完整跑完，但不得改写正式纪录
  const progressBeforeDemo = JSON.stringify(store['echo.progress'] || null);
  fireKey('keydown', 'KeyH'); fireKey('keyup', 'KeyH');
  frames(320);
  await sleep(700);
  frames(6);
  const demoHtml = documentStub.getElementById('overlay').innerHTML || '';
  assert(demoHtml.indexOf('演示完成') >= 0, '参考解演示跑完并显示「演示完成」面板');
  assert(JSON.stringify(store['echo.progress'] || null) === progressBeforeDemo,
    '参考解演示全程未改写正式纪录（存档前后一致）');

  console.log('');
  if (failures) {
    console.log(`✗ 冒烟测试失败 ${failures} 项（版本 ECHO Round3 / ${LEVELS.length} 关）\n`);
    process.exit(1);
  }
  console.log(`✓ 冒烟测试全部通过（版本 ECHO Round3 / ${LEVELS.length} 关）\n`);
  process.exit(0);
})();
