/* =========================================================
 * tools/audit.js —— 关卡「机关必要性」审计
 *
 * 背景：只校验「参考解能通关」是不够的。如果门不是 S→E 的几何割集，
 *      玩家可以从旁边绕过去，整关的时间残影 / 时间锚 / 望远镜机制
 *      在解题上就是可选的 —— 关卡设计等于白做。
 *
 * 本工具给出两条独立证据：
 *   [G] 几何割集：把全部门视为永久关闭、尖刺视为不可通行，
 *       BFS 检查起点能否走到出口。可达 = 门形同虚设（FAIL）。
 *   [N] 无机关可解性：在真实引擎中禁用全部回响（echoEvery 极大、
 *       maxEchoes=0），跑完整 BFS 搜索（含守卫、尖刺、水晶、门、
 *       玩家自踩板），检查是否仍能通关。能通关 = 机制非必要（FAIL）。
 *
 * 用法：node tools/audit.js
 *      退出码 0 = 所有含机关的关卡都必须用到机制
 * ========================================================= */
'use strict';

const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');

/** 纯教学关（无门、无压力板、无水晶、无锚）不参与机关必要性审计 */
function isTutorial(lv) {
  const st0 = Engine.getStatic(lv);
  const hasPlate = st0.tiles.some(row => row.some(t => t.plate));
  const hasCrystal = st0.tiles.some(row => row.some(t => t.crystal));
  const hasAnchor = st0.tiles.some(row => row.some(t => t.anchor));
  const hasDoor = st0.tiles.some(row => row.some(t => t.door));
  return !hasPlate && !hasCrystal && !hasAnchor && !hasDoor;
}

function keyOfCell(x, y) { return x + ',' + y; }

/** [G] 门永久关闭时，起点能否几何绕到出口 */
function geometryBypass(lv) {
  const st0 = Engine.getStatic(lv);
  const doorCount = st0.tiles.reduce((n, row) => n + row.filter(t => t.door).length, 0);
  if (!doorCount) return { hasDoors: false, reachable: null, steps: null };

  const passable = (x, y) => {
    if (x < 0 || y < 0 || x >= st0.cols || y >= st0.rows) return false;
    const t = st0.tiles[y][x];
    // 门视为墙；尖刺（含尖刺压力板）玩家踩上去必死，也视为不可通行
    return !t.wall && !t.door && !t.spike;
  };
  const start = st0.start, exit = st0.exit;
  const seen = new Set([keyOfCell(start.x, start.y)]);
  const q = [{ x: start.x, y: start.y, d: 0, path: '' }];
  const D = [['U', 0, -1], ['D', 0, 1], ['L', -1, 0], ['R', 1, 0]];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur.x === exit.x && cur.y === exit.y) {
      return { hasDoors: true, reachable: true, steps: cur.d, path: cur.path };
    }
    for (const [a, dx, dy] of D) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!passable(nx, ny)) continue;
      const k = keyOfCell(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: nx, y: ny, d: cur.d + 1, path: cur.path + a });
    }
  }
  return { hasDoors: true, reachable: false, steps: null };
}

/** [N] 真实引擎中禁用全部回响后，是否仍存在通关路径 */
function noEchoBypass(lv, maxDepth) {
  maxDepth = maxDepth || 55;
  const variant = Object.assign({}, lv, { echoEvery: 1000000, maxEchoes: 0 });
  const first = Engine.create(variant);
  const key = s => [
    s.player.x, s.player.y,
    s.guards.map(g => g.x + ',' + g.y + g.dir).join('/'),
    s.crystals.map(c => c.taken ? 1 : 0).join(''),
    s.stars.map(t => t.taken ? 1 : 0).join('')
  ].join('#');

  const visited = new Set([key(first)]);
  let frontier = [{ s: first, acts: '' }];
  const ACTIONS = ['U', 'D', 'L', 'R', 'W'];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const a of ACTIONS) {
        const s = Engine.clone(node.s);
        Engine.applyAction(s, a);
        if (s.status === 'dead') continue;
        const acts = node.acts + a;
        if (s.status === 'won') return { solvable: true, steps: acts.length, actions: acts };
        const k = key(s);
        if (visited.has(k)) continue;
        visited.add(k);
        next.push({ s: s, acts: acts });
      }
    }
    frontier = next;
  }
  return { solvable: false, visited: visited.size };
}

/** 对一关做完整审计，返回 { tutorial, gPass, nPass, pass, g, n } */
function auditLevel(lv) {
  if (isTutorial(lv)) {
    return { tutorial: true, gPass: true, nPass: true, pass: true, g: null, n: null };
  }
  const g = geometryBypass(lv);
  const n = noEchoBypass(lv);
  const gPass = !g.hasDoors || g.reachable === false;
  const nPass = !n.solvable;
  return { tutorial: false, gPass, nPass, pass: gPass && nPass, g, n };
}

/* ---------------- CLI ---------------- */
function main(levels) {
  levels = levels || LEVELS;
  console.log('\n=== 《回响》机关必要性审计 ===');
  console.log('[G] 门为几何割集（关闭所有门后 S→E 不可达）');
  console.log('[N] 禁用全部回响后无法通关（残像 / 锚 / 望远镜是必要条件）\n');

  let bad = 0;
  const rows = [];
  for (const lv of levels) {
    const r = auditLevel(lv);
    if (!r.pass) bad++;
    rows.push({
      关卡: `L${lv.id} ${lv.name}`,
      '[G] 门割集': r.tutorial ? 'N/A(教学)' : (!r.g.hasDoors ? 'N/A(无门)' : (r.g.reachable ? `✗ 可绕行 ${r.g.steps} 步` : '✓')),
      '[N] 无机关': r.tutorial ? 'N/A(教学)' : (r.n.solvable ? `✗ 仍可通关 ${r.n.steps} 步` : '✓ 不可通关'),
      结论: r.pass ? '通过' : '失败'
    });
    if (!r.gPass) console.log(`  L${lv.id} 绕行路径（门全关）: ${r.g.path}`);
    if (!r.nPass) console.log(`  L${lv.id} 无机关通关序列: ${r.n.actions}`);
  }
  console.table(rows);
  console.log(bad
    ? `\n✗ ${bad}/${levels.length} 关的机关可被绕过（详见上表）\n`
    : `\n✓ 全部 ${levels.length} 关：门均为割集，且禁用回响后无法通关\n`);
  return bad;
}

if (require.main === module) process.exit(main() ? 1 : 0);

module.exports = { geometryBypass, noEchoBypass, auditLevel, isTutorial, main };
