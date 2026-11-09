/* ============================================================
 * 星尘幸存者 第二轮 逻辑测试运行器（Node，无依赖）
 * 用法：node tests/run-tests.cjs
 * 说明：构造最小浏览器桩环境，加载 index.html 内联脚本（源码零改动），
 *       通过同一 script 作用域追加 window.SSTest 钩子暴露内部符号。
 *       这些测试只验证逻辑规则，不作为手动通关/截图证据。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx2d(){
  const target = {
    canvas: null,
    font: '600 15px sans',
    measureText(s){
      const m = String(this.font).match(/(\d+)px/);
      const size = m ? parseFloat(m[1]) : 15;
      let w = 0;
      for(const ch of String(s)){
        w += ch.codePointAt(0) > 0x2e00 ? size : size * 0.55;
      }
      return { width: w };
    },
    createRadialGradient(){ return { addColorStop(){} }; },
    createLinearGradient(){ return { addColorStop(){} }; },
  };
  return new Proxy(target, {
    get(t, prop){
      if(prop in t) return t[prop];
      // 其余 canvas 方法一律 no-op
      return typeof prop === 'string' ? function(){} : undefined;
    },
    set(t, prop, val){ t[prop] = val; return true; },
  });
}

function loadGame(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if(!m) throw new Error('未找到内联 script');
  let src = m[1];

  const listeners = Object.create(null); // window/document 级事件
  const canvasListeners = Object.create(null);
  const ctx2d = makeCtx2d();
  const canvasStub = {
    width: 960, height: 600, style: {},
    getContext: () => ctx2d,
    addEventListener: (t, fn) => { (canvasListeners[t] ||= []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
  };
  ctx2d.canvas = canvasStub;

  const on = (map) => (type, fn) => { (map[type] ||= []).push(fn); };

  const win = {
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 720,
    AudioContext: class {
      constructor(){ this.state='running'; this.currentTime=0; this.sampleRate=8000; this.destination={}; }
      createBuffer(ch, len){ return { getChannelData: () => new Float32Array(len) }; }
      createBufferSource(){ return { buffer: null, connect(){}, start(){}, stop(){} }; }
      createBiquadFilter(){ return { type: '', frequency: { value: 0 }, connect(){} }; }
      createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; }
      createOscillator(){ return { frequency:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){}, start(){}, stop(){} }; }
      resume(){}
    },
    addEventListener: on(listeners),
    removeEventListener(){},
  };
  const doc = {
    visibilityState: 'visible',
    hidden: false,
    getElementById: () => canvasStub,
    addEventListener: on(listeners),
  };

  let rafCb = null;
  const sandbox = {
    window: win,
    document: doc,
    addEventListener: on(listeners),
    removeEventListener(){},
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout,
    console, Math, Date, JSON, Float32Array, Set, Map, Array, Object, Number, String, Boolean,
  };
  sandbox.globalThis = sandbox;
  win.window = win;

  // 追加测试钩子（与游戏脚本同作用域编译，不修改 index.html）
  const hook = `
    ;window.SSTest = {
      G, STATE, keys,
      get player(){ return player; },
      get bullets(){ return bullets; },
      get ebullets(){ return ebullets; },
      get enemies(){ return enemies; },
      get gems(){ return gems; },
      get particles(){ return particles; },
      get floaters(){ return floaters; },
      UPGRADES,
      ETYPES,
      resetGame, startGame, update, fireWeapon, spawnEnemy, spawnRandom,
      killEnemy, chooseUpgrade, rollChoices, setPause, clearKeys,
      mkGem,
      wrapLines: (typeof wrapLines==='function') ? wrapLines : null,
      edgePos,
      dispatch(ev){
        ev.key = ev.key || '';
        (window.__L && window.__L[ev.type] || []).forEach(fn => fn(ev));
      },
    };
    window.__L = null;
  `;
  // 让事件钩子能拿到监听表
  win.__capture = listeners;
  vm.createContext(sandbox);
  vm.runInContext(src + hook, sandbox, { filename: 'index.html<script>' });
  vm.runInContext('window.__L = null;', sandbox);
  // 直接把桩监听表挂到 SSTest.dispatch 使用
  win.SSTest.dispatch = function(ev){
    ev.key = ev.key || '';
    (listeners[ev.type] || []).forEach(fn => fn(ev));
  };
  return {
    SSTest: win.SSTest, listeners, canvasListeners,
    setVisibility(s){ doc.visibilityState = s; doc.hidden = (s === 'hidden'); },
  };
}

/* ---- 极简测试框架 ---- */
let passed = 0, failed = 0;
const failures = [];
function test(name, fn){
  try { fn(); passed++; process.stdout.write('  PASS  ' + name + '\n'); }
  catch(err){
    failed++; failures.push({ name, err });
    process.stdout.write('  FAIL  ' + name + '\n        ' + err.message + '\n');
  }
}
function eq(actual, expected, msg){
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if(a !== e) throw new Error((msg || '断言失败') + `：期望 ${e}，实际 ${a}`);
}
function ok(cond, msg){ if(!cond) throw new Error(msg || '期望为真'); }

module.exports = { loadGame, test, eq, ok, summary(){
  process.stdout.write(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  return failed;
}};
