// ============================================================================
// 《问道2048·修仙录》无头逻辑测试框架（Node >= 18，无第三方依赖）
// 用法：
//   node tests/harness.mjs                                 -> 测试当前 index.html（v2）
//   node tests/harness.mjs tests/v1_original_for_regression.html -> 在 v1 基线上复现缺陷
// 原理：提取目标 HTML 的 <script> 块，在 vm 沙箱中用 DOM/存档/计时器桩运行，
//       计时器可立即冲刷（flush），纯逻辑入口（applyMove/settleAfterMove）不依赖动画时序。
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "index.html");
const html = readFileSync(target, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("未找到 <script> 块"); process.exit(2); }
const scriptSrc = m[1];
const IS_V2 = /applyMove/.test(scriptSrc);
const BEST_KEY = "wd2048_best";
const CH_RECORD_KEY = "wd2048_challenges_v1";

/* ---------------- DOM / 存档 / 计时器桩 ---------------- */
function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    parentNode: null,
    style: { setProperty() {} },
    dataset: {},
    disabled: false,
    clientWidth: 400,
    offsetWidth: 0,
    _text: "",
    _html: "",
    __listeners: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) {
        const want = force === undefined ? !this._s.has(c) : !!force;
        if (want) this._s.add(c); else this._s.delete(c);
      },
    },
    addEventListener(type, fn) { (this.__listeners[type] = this.__listeners[type] || []).push(fn); },
    appendChild(ch) { this.children.push(ch); ch.parentNode = this; return ch; },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    },
    setAttribute() {},
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = v; if (v === "") this.children = []; },
  });
  Object.defineProperty(el, "textContent", {
    get() { return this._text; },
    set(v) { this._text = String(v); },
  });
  return el;
}

const ELEMENT_IDS = [
  "app", "board", "cells", "tiles", "toast", "score", "best",
  "overlay", "ovTitle", "ovText", "ovBtns",
  "challengePanel", "chList", "challengeInfo", "chName", "chGoal", "chMoves",
  "tabClassic", "tabChallenge", "spellShiftBtn", "spellDissolveBtn",
  "undoBtn", "restartBtn", "hintText", "lqDots", "chClose",
];

function makeDocument() {
  const byId = {};
  for (const id of ELEMENT_IDS) byId[id] = makeEl("div");
  return {
    byId,
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
  };
}

function makeStorage(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map,
  };
}

function loadGame(opts = {}) {
  const doc = makeDocument();
  const storage = makeStorage(opts.storage);
  const timers = [];
  const sandbox = {
    console, Math, Date, JSON, Number, String, parseInt, Infinity,
    document: doc,
    localStorage: storage,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptSrc, sandbox, { filename: "game-script.js" });
  const flush = () => {
    let n = 0;
    while (timers.length && n < 5000) { timers.shift()(); n++; }
  };
  const click = el => { (el.__listeners.click || []).slice().forEach(fn => fn()); };
  return { sandbox, api: sandbox.__wd2048, doc, storage, flush, click };
}

/* ---------------- 断言与结果收集 ---------------- */
const results = [];
function check(id, name, fn) {
  try { fn(); results.push({ id, name, status: "通过", detail: "" }); }
  catch (e) { results.push({ id, name, status: "未通过", detail: e.message }); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }
function eq(actual, expected, msg) {
  const A = JSON.stringify(actual), B = JSON.stringify(expected);
  if (A !== B) throw new Error(`${msg || "相等断言"}：期望 ${B}，实际 ${A}`);
}
function tileCount(values) { let n = 0; for (const row of values) for (const v of row) if (v) n++; return n; }
function valuesToCounts(values) {
  const cnt = {};
  for (const row of values) for (const v of row) if (v) cnt[v] = (cnt[v] || 0) + 1;
  return cnt;
}
function canMoveValues(values) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = values[r][c];
    if (!v) return true;
    if (r + 1 < 4 && values[r + 1][c] === v) return true;
    if (c + 1 < 4 && values[r][c + 1] === v) return true;
  }
  return false;
}
const FULL = [[1024, 1024, 2, 4], [8, 16, 32, 64], [128, 256, 512, 8], [16, 32, 64, 128]];

/* ---------------- 启发式自动对局（仅用于内容验收，非玩家替代证据） ---------------- */
function simMove(values, dir) {
  const V = [[-1, 0], [0, 1], [1, 0], [0, -1]][dir];
  const idx = [0, 1, 2, 3];
  const rows = V[0] === 1 ? [...idx].reverse() : idx;
  const cols = V[1] === 1 ? [...idx].reverse() : idx;
  const g = values.map(r => r.slice());
  const merged = Array.from({ length: 4 }, () => [false, false, false, false]);
  let moved = false, gain = 0;
  for (const r of rows) for (const c of cols) {
    const v = g[r][c];
    if (!v) continue;
    let nr = r, nc = c;
    for (;;) {
      const tr = nr + V[0], tc = nc + V[1];
      if (tr < 0 || tr > 3 || tc < 0 || tc > 3 || g[tr][tc]) break;
      nr = tr; nc = tc;
    }
    const tr = nr + V[0], tc = nc + V[1];
    if (tr >= 0 && tr < 4 && tc >= 0 && tc < 4 && g[tr][tc] === v && !merged[tr][tc]) {
      g[r][c] = 0; g[tr][tc] = v * 2; merged[tr][tc] = true; gain += v * 2; moved = true;
    } else if (nr !== r || nc !== c) {
      g[r][c] = 0; g[nr][nc] = v; moved = true;
    }
  }
  return { values: g, moved, gain };
}
function emptiesOf(values) { let n = 0; for (const row of values) for (const v of row) if (!v) n++; return n; }
// 蛇形权重：引导大牌沉底、按蛇形排布（经典 2048 启发式）
const SNAKE_W = [
  [1, 2, 3, 4],
  [128, 64, 32, 8],
  [256, 512, 1024, 2048],
  [65536, 32768, 16384, 4096],
];
function evalBoard(values) {
  let s = 0, emp = 0, smooth = 0, merges = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = values[r][c];
    if (v) {
      const lv = Math.log2(v);
      s += lv * SNAKE_W[r][c];
      if (c + 1 < 4 && values[r][c + 1]) {
        const d = lv - Math.log2(values[r][c + 1]);
        if (d === 0) merges++; else smooth -= Math.abs(d);
      }
      if (r + 1 < 4 && values[r + 1][c]) {
        const d = lv - Math.log2(values[r + 1][c]);
        if (d === 0) merges++; else smooth -= Math.abs(d);
      }
    } else emp++;
  }
  return s + emp * 20000 + smooth * 800 + merges * 3000;
}
// 玩家节点：depth = 本层之后剩余的玩家层数
function moveNode(values, depth) {
  let bestSc = -Infinity;
  for (let d = 0; d < 4; d++) {
    const s = simMove(values, d);
    if (!s.moved) continue;
    const sc = (depth > 0 ? chanceNode(s.values, depth - 1) : evalBoard(s.values)) + s.gain * 2;
    if (sc > bestSc) bestSc = sc;
  }
  return bestSc === -Infinity ? evalBoard(values) - 1e9 : bestSc; // 无合法步：重罚
}
// 机会节点：全部空位 × 2(0.9)/4(0.1) 落子加权平均
function chanceNode(values, depth) {
  const empties = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!values[r][c]) empties.push(r * 4 + c);
  if (!empties.length) return moveNode(values, depth);
  let sc = 0;
  for (const pos of empties) {
    const r = pos >> 2, c = pos & 3;
    values[r][c] = 2;
    sc += (0.9 / empties.length) * moveNode(values, depth);
    values[r][c] = 4;
    sc += (0.1 / empties.length) * moveNode(values, depth);
    values[r][c] = 0;
  }
  return sc;
}
function chooseDir(values) {
  let emp = 0;
  for (const row of values) for (const v of row) if (!v) emp++;
  const depth = emp <= 4 ? 2 : 1; // 紧张局面搜更深，开阔局面求速度
  let best = null;
  for (let d = 0; d < 4; d++) {
    const s = simMove(values, d);
    if (!s.moved) continue;
    const sc = chanceNode(s.values, depth) + s.gain * 2;
    if (!best || sc > best.sc) best = { d, sc };
  }
  return best ? best.d : null;
}
// c3 禁落子盘的手工推演解（方向：0上 1右 2下 3左）：
// 下 → 左×3（底行 8,4,2,2 → 16）→ 右（16 滑至右下）→ 下（与 row2 的 16/64/32 合并归位）→ 左×3（级联合成 256），共 9 步
const REF_SEQ = { c3: [2, 3, 3, 3, 1, 2, 3, 3, 3] };
function playSeq(g, seq) {
  const api = g.api;
  for (const d of seq) {
    if (api.getState().over) break;
    const res = api.applyMove(d);
    if (!res) break;
    api.settleAfterMove(res);
  }
  return { steps: api.getState().movesUsed, state: api.getState(), seq };
}
// 自动对局：走启发式直到结算或超出预算；返回 {steps, state, seq}
function autoPlay(g, budget) {
  const api = g.api;
  const seq = [];
  let steps = 0;
  while (steps < budget) {
    const st = api.getState();
    if (st.over) break;
    const d = chooseDir(st.values);
    if (d === null) break;
    const res = api.applyMove(d);
    if (!res) break;
    api.settleAfterMove(res);
    seq.push(d);
    steps++;
  }
  return { steps, state: api.getState(), seq };
}

/* ============================================================================
 * 测试用例
 * ==========================================================================*/

/* ---------- Q1 终局回归 ---------- */
if (IS_V2) {
  check("Q1a", "终局：满盘合成2048且落子后无合法步——先飞升，继续后转失败，不卡死", () => {
    let foundSeed = null;
    for (let s = 1; s <= 200 && foundSeed === null; s++) {
      const g = loadGame();
      const api = g.api;
      api.startClassic();
      api.setGrid(FULL);
      api.seed(s);
      const res = api.applyMove(3);
      ok(res, "左移应为有效移动");
      api.settleAfterMove(res);
      const st = api.getState();
      if (st.overlay === "win" && !api.canMove()) foundSeed = s;
    }
    ok(foundSeed !== null, "种子1..200内应找到落子后成死局的种子");
    // 用找到的种子走完整流程
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.setGrid(FULL);
    api.seed(foundSeed);
    const res = api.applyMove(3);
    api.settleAfterMove(res);
    eq(api.getState().overlay, "win", "应先显示飞升");
    api.continueAfterWin();
    eq(api.getState().overlay, "lose", "继续后死局应立即转入失败结算");
    ok(api.getState().over, "失败后 over 为真");
    eq(api.applyMove(3), null, "失败后输入无效");
    eq(api.getState().overlay, "lose", "失败结算保持，不能无限继续");
  });

  check("Q1b", "终局：合成2048后仍有合法步——继续后能正常移动", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.setGrid([[1024, 1024, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    api.seed(7);
    const res = api.applyMove(3);
    api.settleAfterMove(res);
    eq(api.getState().overlay, "win", "应显示飞升");
    api.continueAfterWin();
    eq(api.getState().overlay, null, "盘面存活，继续后不应转失败");
    ok(api.canMove(), "应存在合法步");
    let movedOnce = false;
    for (let d = 0; d < 4 && !movedOnce; d++) {
      const r2 = api.applyMove(d);
      if (r2) { api.settleAfterMove(r2); movedOnce = true; }
    }
    ok(movedOnce, "继续后能再完成一次有效移动");
  });
} else {
  // v1 基线：复现评分报告确认的终局缺陷（预期“未通过”，作为修复前证据）
  check("Q1a", "v1复现：满盘合成2048且死局，继续后无效移动提前返回，无法转入失败结算", () => {
    let stuck = null;
    for (let attempt = 0; attempt < 80 && stuck === null; attempt++) {
      const g = loadGame();
      const api = g.api;
      api.setGrid(FULL);
      api.move(3);
      g.flush();
      const st = api.getState();
      if (!st.over) continue;
      if (canMoveValues(st.values)) continue; // 需要落子后恰好死局
      const continueBtn = g.doc.byId.ovBtns.children[0];
      ok(continueBtn, "胜利结算应有继续按钮");
      g.click(continueBtn); // 模拟玩家点击“继续修行”
      api.move(3);           // 玩家尝试移动（无效）
      g.flush();
      const st2 = api.getState();
      const overlayHidden = g.doc.byId.overlay.classList.contains("hidden");
      stuck = { overlayHidden, over: st2.over };
    }
    ok(stuck !== null, "应能构造出胜利+死局场景");
    ok(!(stuck.overlayHidden && !stuck.over),
      "继续后应能转入失败结算（v1 实际：遮罩隐藏且未进入失败，卡死）");
  });
}

/* ---------- Q2 撤销覆盖 ---------- */
function snapOf(api) {
  const st = api.getState();
  return {
    values: st.values, score: st.score, mode: st.mode,
    lingqi: st.lingqi, cdShift: st.cdShift, cdDissolve: st.cdDissolve,
    wonShown: st.wonShown, keepPlaying: st.keepPlaying, highest: st.highest,
    movesLeft: st.movesLeft, movesUsed: st.movesUsed, rngState: st.rngState,
  };
}

if (IS_V2) {
  check("Q2a", "撤销：2048胜利可完整回退（含 wonShown 胜利提示状态）", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.setGrid([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    api.seed(3);
    const before = snapOf(api);
    const res = api.applyMove(3);
    api.settleAfterMove(res);
    eq(api.getState().overlay, "win", "应出现飞升结算");
    ok(api.getState().wonShown, "wonShown 应置真");
    ok(api.undo(), "撤销应成功");
    eq(snapOf(api), before, "撤销后完整状态与操作前一致");
    eq(api.getState().overlay, null, "结算遮罩消失");
    ok(!api.getState().over, "over 解除");
  });

  check("Q2b", "撤销：普通移动——状态回滚且随机后续落子一致", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(42);
    api.setGrid([[2, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 8], [0, 0, 0, 16]]);
    const before = snapOf(api);
    const res = api.applyMove(3);
    ok(res, "移动有效");
    api.settleAfterMove(res);
    const afterMove = api.getState();
    ok(api.undo(), "撤销成功");
    eq(snapOf(api), before, "撤销后状态完全一致（含随机源）");
    const res2 = api.applyMove(3);
    api.settleAfterMove(res2);
    eq(api.getState().values, afterMove.values, "重做移动的随机落子与之前一致");
    eq(api.getState().score, afterMove.score, "分数一致");
  });

  check("Q2c", "撤销：合成操作——分数与棋盘回滚", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(1);
    api.setGrid([[2, 2, 4, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const before = snapOf(api);
    const res = api.applyMove(3);
    api.settleAfterMove(res);
    eq(api.getState().score, before.score + 4, "合成分 +4");
    ok(api.undo());
    eq(snapOf(api), before, "撤销后状态完全一致");
  });

  check("Q2d", "撤销：法术乾坤挪移——灵气/调息/牌位/随机源回滚", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(5);
    api.setGrid([[2, 4, 8, 16], [32, 64, 128, 256], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const before = snapOf(api);
    ok(api.applySpellRaw("shift"), "施法成功");
    const stMid = api.getState();
    eq(valuesToCounts(stMid.values), valuesToCounts(before.values), "重排不改变牌面集合");
    eq(stMid.lingqi, 2, "灵气 -1");
    eq(stMid.cdShift, 2, "进入调息");
    ok(api.undo(), "撤销成功");
    eq(snapOf(api), before, "撤销后状态完全一致");
  });

  check("Q2e", "撤销：法术焚天化劫——移除/灵气/调息回滚", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(6);
    api.setGrid([[2, 4, 8, 16], [32, 64, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const before = snapOf(api);
    ok(api.applySpellRaw("dissolve"), "施法成功");
    const stMid = api.getState();
    eq(tileCount(stMid.values), tileCount(before.values) - 1, "移除一张牌");
    eq(stMid.lingqi, 1, "灵气 -2");
    eq(stMid.cdDissolve, 3, "进入调息");
    ok(api.undo(), "撤销成功");
    eq(snapOf(api), before, "撤销后状态完全一致");
  });

  check("Q2f", "撤销：胜利后继续再移动——撤销回到继续时状态", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(9);
    api.setGrid([[1024, 1024, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const res = api.applyMove(3);
    api.settleAfterMove(res);
    eq(api.getState().overlay, "win");
    api.continueAfterWin();
    const beforeMove = snapOf(api);
    let moved = null;
    for (let d = 0; d < 4 && moved === null; d++) {
      const r2 = api.applyMove(d);
      if (r2) { api.settleAfterMove(r2); moved = d; }
    }
    ok(moved !== null, "继续后应有合法步");
    ok(api.undo(), "撤销成功");
    eq(snapOf(api), beforeMove, "撤销回到继续后的操作前状态（wonShown 保持）");
    eq(api.getState().overlay, null, "无结算遮罩");
    ok(!api.getState().over, "可继续游玩");
  });

  check("Q2g", "撤销：20步上限——第21步按上限策略不响应", () => {
    let verified = false;
    for (let seed = 77; seed < 120 && !verified; seed++) {
      const g = loadGame();
      const api = g.api;
      api.startClassic();
      api.seed(seed);
      let applied = 0;
      for (let i = 0; i < 25; i++) {
        let done = false;
        for (let d = 0; d < 4 && !done; d++) {
          const r = api.applyMove(d);
          if (r) { api.settleAfterMove(r); done = true; }
        }
        if (!done || api.getState().over) break;
        applied++;
      }
      if (applied < 21) continue;
      eq(api.getState().historyLen, 20, "快照栈按上限20保存");
      for (let i = 0; i < 20; i++) ok(api.undo(), `第${i + 1}次撤销应成功`);
      eq(api.getState().historyLen, 0, "20次后栈空");
      const stBefore21 = api.getState();
      eq(api.undo(), false, "第21次撤销不响应");
      eq(api.getState().values, stBefore21.values, "第21次撤销不改变状态");
      verified = true;
    }
    ok(verified, "应找到可连续21步有效移动的种子");
  });
} else {
  // v1 基线：撤销快照不含 wonShown（预期“未通过”，作为修复前证据）
  check("Q2a", "v1复现：撤销不恢复 wonShown 胜利提示状态", () => {
    const g = loadGame();
    const api = g.api;
    api.setGrid([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    api.move(3);
    g.flush();
    ok(api.getState().wonShown, "胜利后 wonShown 为真");
    api.undo(); // v1 的 undo 无返回值，不断言返回值
    eq(api.getState().wonShown, false, "撤销应把 wonShown 还原为假（v1 快照缺失该字段）");
  });
}

/* ---------- Q3 确定性 ---------- */
if (IS_V2) {
  check("Q3", "确定性：同一输入序列重复20次，棋盘与结果完全一致（含经典与禁落子盘）", () => {
    const fixedSeq = len => Array.from({ length: len }, (_, i) => [3, 0, 1, 2][i % 4]);
    const runOnce = (kind, id) => {
      const g = loadGame();
      const api = g.api;
      if (kind === "classic") {
        api.startClassic();
        // 固定初始盘与种子：startClassic 自身用时间戳播种，需覆盖以保证确定性
        api.setGrid([[2, 0, 0, 4], [0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 8]]);
        api.seed(12345);
      } else api.startChallenge(id);
      const seq = fixedSeq(120);
      for (const d of seq) {
        if (api.getState().over) break;
        const r = api.applyMove(d);
        if (r) api.settleAfterMove(r);
      }
      const fin = api.getState();
      return JSON.stringify({ v: fin.values, s: fin.score, m: fin.movesUsed, o: fin.over, w: fin.wonShown });
    };
    for (const kind of [["challenge", "c1"], ["challenge", "c3"], ["challenge", "c6"], ["classic", null]]) {
      const [k, id] = kind;
      const baseline = runOnce(k, id);
      for (let run = 1; run < 20; run++) {
        eq(runOnce(k, id), baseline, `${id || "classic"} 第${run + 1}次运行应与首次一致`);
      }
    }
  });
}

/* ---------- Q4 内容与记录 ---------- */
if (IS_V2) {
  const CH_IDS = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const CH_LIMIT = { c1: 400, c2: 100, c3: 30, c4: 90, c5: 80, c6: 160 };
  const refSolutions = {};

  for (const id of CH_IDS) {
    check("Q4-" + id, `挑战 ${id}：可进入、可通关、记录步数（${REF_SEQ[id] ? "手工解复播" : "启发式参考解"}）`, () => {
      const g = loadGame();
      const api = g.api;
      // 通过正式 UI 入口进入（点击“试炼秘境”→“入定挑战”）
      g.click(g.doc.byId.tabChallenge);
      const items = g.doc.byId.chList.children;
      const idx = CH_IDS.indexOf(id);
      const enterBtn = items[idx].children[2];
      g.click(enterBtn);
      eq(api.getState().mode, id, "进入挑战模式");
      const r = REF_SEQ[id] ? playSeq(g, REF_SEQ[id]) : autoPlay(g, CH_LIMIT[id]);
      eq(r.state.overlay, "challenge-clear", `应达成目标（实际 steps=${r.steps}, overlay=${r.state.overlay}）`);
      ok(r.state.movesUsed <= (CH_LIMIT[id] || 999), "步数在限制内");
      refSolutions[id] = { steps: r.state.movesUsed, seq: r.seq, source: REF_SEQ[id] ? "manual" : "heuristic" };
    });
  }

  check("Q4-spell-limit", "法术：资源不足/调息中不可施放，失败施法不进撤销历史", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(8);
    api.setGrid([[2, 4, 8, 16], [32, 64, 2, 4], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const h0 = api.getState().historyLen;
    ok(api.applySpellRaw("dissolve"), "首次焚天化劫成功（耗2灵）");
    eq(api.getState().lingqi, 1, "剩1灵");
    eq(api.getState().cdDissolve, 3, "焚天化劫进入3步调息");
    eq(api.applySpellRaw("dissolve"), null, "灵气不足（需2有1）不能再施放");
    ok(api.applySpellRaw("shift"), "乾坤挪移只需1灵，可以施放");
    eq(api.getState().lingqi, 0, "灵气耗尽");
    eq(api.applySpellRaw("shift"), null, "灵气不足且调息中不能施放");
    eq(api.getState().historyLen, h0 + 2, "失败的施法不进撤销历史，仅成功的2次入栈");
    // 连续撤销两次：先撤挪移，再撤化劫，状态逐层还原
    const stAfterDissolve = api.getState();
    ok(api.undo(), "撤销挪移");
    eq(api.getState().lingqi, 1, "挪移回滚：灵气恢复");
    eq(api.getState().cdShift, 0, "挪移回滚：调息清零");
    ok(api.undo(), "撤销化劫");
    eq(api.getState().lingqi, 3, "化劫回滚：灵气恢复");
    eq(api.getState().cdDissolve, 0, "化劫回滚：调息清零");
    eq(tileCount(api.getState().values), tileCount(stAfterDissolve.values) + 1, "被移除的牌回归");
    // 调息随有效移动递减
    ok(api.applySpellRaw("shift"), "再次挪移");
    eq(api.getState().cdShift, 2, "调息2步");
    eq(api.applySpellRaw("shift"), null, "调息中不能再次挪移");
    const r1 = api.applyMove(3);
    ok(r1, "存在有效移动");
    api.settleAfterMove(r1);
    eq(api.getState().cdShift, 1, "一步有效移动后调息-1");
  });

  check("Q4-classic-lose", "经典：确定死局盘面触发失败结算", () => {
    const g = loadGame();
    const api = g.api;
    api.startClassic();
    api.seed(4);
    api.setGrid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 8, 8]]);
    const res = api.applyMove(3);
    ok(res, "底行可合成，移动有效");
    api.settleAfterMove(res);
    eq(api.getState().overlay, "lose", "落子后必死局，触发失败结算");
    // 重复结算防护：结算后输入无效且遮罩不变
    eq(api.applyMove(3), null, "结算后输入无效");
    eq(api.getState().overlay, "lose", "不重复结算");
  });

  check("Q4-records", "记录隔离与兼容迁移：旧键迁入经典，挑战不覆盖经典，刷新后保留", () => {
    const g = loadGame({ storage: { [BEST_KEY]: "1234" } });
    const api = g.api;
    eq(api.getState().best, 1234, "旧 v1 键的最高纪录被迁入");
    // 正式经典局：init 已开局（officialRun=true），applyMove 直连不置假；
    // 纪录在 applyMove 内实时更新，无需整局走到底
    const r1 = autoPlay(g, 150);
    ok(r1.state.score > 0, "经典局产生合成得分");
    const classicBest = +g.storage.getItem(BEST_KEY);
    ok(classicBest >= 1234, "经典纪录不小于迁入值");
    ok(classicBest >= r1.state.score, "经典纪录已写入本局最高分");
    // 正式进入 c1 并通关
    g.click(g.doc.byId.tabChallenge);
    g.click(g.doc.byId.chList.children[0].children[2]);
    const r2 = autoPlay(g, 400);
    eq(r2.state.overlay, "challenge-clear", "c1 通关");
    eq(+g.storage.getItem(BEST_KEY), classicBest, "挑战得分不覆盖经典最高纪录");
    const rec = JSON.parse(g.storage.getItem(CH_RECORD_KEY));
    ok(rec.c1 && rec.c1.cleared && rec.c1.bestMoves === r2.state.movesUsed, "挑战纪录独立保存");
    // 模拟刷新：同一存档重新加载
    const init = {};
    for (const [k, v] of g.storage._map) init[k] = v;
    const g2 = loadGame({ storage: init });
    eq(g2.api.getState().best, classicBest, "刷新后经典纪录保留");
    g2.click(g2.doc.byId.tabChallenge);
    const badge = g2.doc.byId.chList.children[0].children[0].children[1];
    ok(badge.textContent.includes("已通关"), "刷新后挑战通关状态保留");
  });

  check("Q4-restart10", "稳定性：连续重开10次状态干净", () => {
    const g = loadGame();
    const api = g.api;
    for (let i = 0; i < 10; i++) {
      api.startClassic();
      const st = api.getState();
      eq(st.score, 0, `第${i + 1}次重开分数归零`);
      eq(st.over, false, "over 为假");
      eq(st.overlay, null, "无残留遮罩");
      eq(tileCount(st.values), 2, "开局2张牌");
      eq(st.lingqi, 3, "灵气重置");
      eq(st.historyLen, 0, "撤销历史清空");
    }
  });

  check("Q4-freshload", "稳定性：全新加载不带旧局临时状态", () => {
    const g = loadGame();
    const st = g.api.getState();
    eq(st.mode, "classic", "默认经典模式");
    eq(st.score, 0);
    eq(st.over, false);
    eq(st.overlay, null);
    eq(tileCount(st.values), 2, "开局2张牌");
  });

  // 参考解落盘（供复播与文档引用）
  try {
    writeFileSync(path.join(__dirname, "reference_solutions.json"),
      JSON.stringify({ note: "启发式自动对局参考解（0上 1右 2下 3左），非手动通关证据", solutions: refSolutions }, null, 2));
  } catch (e) { /* 写入失败不影响测试结论 */ }
}

/* ---------------- 输出 ---------------- */
console.log(`\n目标文件: ${target}`);
console.log(`版本识别: ${IS_V2 ? "v2（第二轮实现）" : "v1（第一轮基线）"}\n`);
let fail = 0;
for (const r of results) {
  const line = `[${r.status}] ${r.id} ${r.name}`;
  console.log(line);
  if (r.detail) console.log(`        -> ${r.detail}`);
  if (r.status === "未通过") fail++;
}
console.log(`\n合计 ${results.length} 项：通过 ${results.length - fail}，未通过 ${fail}`);
process.exit(fail ? 1 : 0);
