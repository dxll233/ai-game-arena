/* =========================================================
 * tools/solver.js —— A* 自动求解器（开发期工具）
 *
 * 作用：对每一关自动搜索「最短通关动作序列」，
 *      搜索结果回填进 js/levels.js 作为内置参考解与 par。
 *      保证：交给玩家的每一关都 100% 可解，且 par 就是可达的。
 *
 * 用法：
 *   node tools/solver.js            # 全部关卡
 *   node tools/solver.js 5          # 只求第 5 关
 *   node tools/solver.js 5 stars    # 附加：要求集齐星尘
 * ========================================================= */
'use strict';

const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');

const ACTIONS = ['U', 'D', 'L', 'R', 'W'];

function cloneState(s) {
  const c = { def: s.def };
  for (const k in s) {
    if (k === 'def') continue;
    c[k] = JSON.parse(JSON.stringify(s[k]));
  }
  return c;
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/* ---- 预计算：忽略机关时的真实最短步行距离（考虑墙与尖刺），用于更强的启发式 ---- */
const distCache = new Map();

function buildDist(level, target) {
  const st0 = Engine.getStatic(level);
  const key = level.id + ':' + target.x + ',' + target.y;
  if (distCache.has(key)) return distCache.get(key);
  const W = st0.cols, H = st0.rows;
  const dist = new Int32Array(W * H).fill(-1);
  const idx = (x, y) => y * W + x;
  const passable = (x, y) => {
    const t = st0.tiles[y][x];
    // 门视为可通过；尖刺不排除（排除会让距离表高估、启发式不再可采纳）。
    // 玩家踩尖刺致死由 replay 过滤，不影响 BFS 下界的正确性。
    return !t.wall;
  };
  const q = [target];
  dist[idx(target.x, target.y)] = 0;
  let head = 0;
  const D = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (head < q.length) {
    const cur = q[head++];
    const cd = dist[idx(cur.x, cur.y)];
    for (const d of D) {
      const nx = cur.x + d[0], ny = cur.y + d[1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!passable(nx, ny)) continue;
      if (dist[idx(nx, ny)] !== -1) continue;
      dist[idx(nx, ny)] = cd + 1;
      q.push({ x: nx, y: ny });
    }
  }
  distCache.set(key, { W, H, dist });
  return distCache.get(key);
}

function distAt(level, table, x, y) {
  const v = table.dist[y * table.W + x];
  return v < 0 ? Infinity : v;
}

/** 可采纳启发式：剩余步数下界 */
function heuristic(level, state, needStars) {
  const st0 = Engine.getStatic(level);
  const exitD = buildDist(level, st0.exit);
  let h = distAt(level, exitD, state.player.x, state.player.y);

  // 必须先集齐水晶（出口钥匙）
  for (const c of state.crystals) {
    if (c.taken) continue;
    const cd = buildDist(level, c);
    const viaC = distAt(level, cd, state.player.x, state.player.y) + distAt(level, exitD, c.x, c.y);
    h = Math.max(h, viaC);
  }
  // 若要求收集星尘，用「最近邻串联」作为下界（曼哈顿距离，恒不小估）
  if (needStars) {
    let stars = state.stars.filter(s => !s.taken);
    let cur = { x: state.player.x, y: state.player.y };
    let cost = 0;
    while (stars.length) {
      let best = Infinity, bi = -1;
      stars.forEach((s, i) => {
        const d = manhattan(cur, s);
        if (d < best) { best = d; bi = i; }
      });
      cost += best;
      cur = stars[bi];
      stars = stars.filter((_, i) => i !== bi);
    }
    h = Math.max(h, cost + manhattan(cur, st0.exit));
  }
  return h;
}

function keyOf(state) {
  const T = state.T;
  const from = Math.max(0, state.step - T);
  const pos = state.history.slice(from).map(p => p.x + ',' + p.y).join(';');
  const acts = state.timeline.slice(from).join('');
  const echoes = state.echoes.map(e => e.x + ',' + e.y + (e.done ? 'F' : '') + ':' + e.seq.slice(e.i).join('')).join('/');
  const guards = state.guards.map(g => g.x + ',' + g.y + g.dir).join('/');
  const taken = state.crystals.map(c => (c.taken ? '1' : '0')).join('') + '|' +
    state.stars.map(s => (s.taken ? '1' : '0')).join('');
  // 第二轮：锚点记录会改变后续所有回响的起点，必须进入状态去重键
  const anchor = state.anchor ? state.anchor.x + ',' + state.anchor.y + '@' + state.anchor.step : '-';
  return [state.step % T, state.player.x, state.player.y, pos, acts, echoes, guards, taken, anchor].join('#');
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
}

function replay(level, actions) {
  const s = Engine.create(level);
  for (let i = 0; i < actions.length; i++) {
    Engine.applyAction(s, actions[i]);
    if (s.status !== 'playing') return s;
  }
  return s;
}

/**
 * @param {object} level 关卡定义
 * @param {object} opts  { maxNodes, maxDepth, budgetMs, needStars }
 */
function solve(level, opts) {
  opts = opts || {};
  const maxNodes = opts.maxNodes || 3000000;
  const maxDepth = opts.maxDepth || 90;
  const budget = opts.budgetMs || 240000;
  const needStars = !!opts.needStars && level.stars !== false;

  const start = Engine.create(level);
  const hasStars = start.stars.length > 0;
  const goalNeedsStars = needStars && hasStars;

  const t0 = Date.now();
  const open = new Heap();
  const bestG = new Map();          // 关键：支配剪枝，避免堆中堆积重复状态
  const startKey = keyOf(start);
  bestG.set(startKey, 0);
  open.push({ g: 0, f: heuristic(level, start, goalNeedsStars), acts: '', k: startKey });
  let expanded = 0, pruned = 0;

  while (open.size) {
    if (expanded > maxNodes || Date.now() - t0 > budget) {
      return { ok: false, reason: '资源耗尽', expanded, pruned, ms: Date.now() - t0 };
    }
    const node = open.pop();
    if (node.g > maxDepth) continue;
    expanded++;

    const st = replay(level, node.acts);
    if (st.status === 'won') {
      const starsLeft = st.stars.filter(s => !s.taken).length;
      if (!goalNeedsStars || starsLeft === 0) {
        return { ok: true, actions: node.acts, steps: node.g, expanded, ms: Date.now() - t0 };
      }
      continue;
    }
    if (st.status !== 'playing') continue;

    for (const a of ACTIONS) {
      const next = cloneState(st);
      Engine.applyAction(next, a);
      if (next.status === 'dead') continue;
      const g = node.g + 1;
      const k = keyOf(next);
      const prev = bestG.get(k);
      if (prev !== undefined && prev <= g) { pruned++; continue; }
      bestG.set(k, g);
      const h = heuristic(level, next, goalNeedsStars);
      open.push({ g, f: g + h, acts: node.acts + a, k });
    }
  }
  return { ok: false, reason: '搜索空间穷尽（无解）', expanded, pruned, ms: Date.now() - t0 };
}

module.exports = { solve: solve, replay: replay, heuristic: heuristic };

/* ---------------- CLI ---------------- */
if (require.main !== module) return;

const argLevel = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const wantStars = process.argv.includes('stars');

const targets = argLevel ? LEVELS.filter(l => l.id === argLevel) : LEVELS;
if (!targets.length) {
  console.error('找不到关卡 ' + argLevel);
  process.exit(1);
}

console.log('\n=== 《回响》自动求解 ===\n');
const results = {};
for (const lv of targets) {
  const hasStars = Engine.create(lv).stars.length > 0;
  let rec = { level: lv.id, name: lv.name };

  let r1 = solve(lv, { needStars: false });
  rec.base = r1;
  if (r1.ok) {
    let best = r1;
    if (hasStars || wantStars) {
      const r2 = solve(lv, { needStars: true });
      rec.starred = r2;
      if (r2.ok) best = r2;
    }
    rec.best = best;
    console.log(
      `第 ${lv.id} 关《${lv.name}》\n` +
      `   最短通关 : ${r1.ok ? r1.steps + ' 步  ' + r1.actions : '未找到（' + r1.reason + '）'}\n` +
      (rec.starred
        ? `   带全收集 : ${rec.starred.ok ? rec.starred.steps + ' 步  ' + rec.starred.actions : '未找到（' + rec.starred.reason + '）'}\n`
        : '') +
      `   建议 par : ${best.steps + 2}\n` +
      `   建议写入 solution: '${best.actions}'\n`
    );
  } else {
    console.log(`第 ${lv.id} 关《${lv.name}》 ✗ ${r1.reason} (展开 ${r1.expanded} 节点, ${r1.ms}ms)`);
  }
  results[lv.id] = rec;
}
console.log('完成。\n');
