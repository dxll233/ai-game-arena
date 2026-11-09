/* =========================================================
 * tools/guard_evidence.js —— 第 15 关守卫「解题作用」量化证据
 *
 * 只回答一个问题：把守卫拿掉，这关会变松吗？
 *
 *  [A] 最短全收集解：有守卫 vs 无守卫（同一起点、同一机关布局）
 *  [B] 咽喉通过拍：在玩家踏入走廊的那一拍前插入一拍 W，
 *      两版分别回放 —— 守卫版应因相位错开而失败，无守卫版仍能通关。
 *  [C] 解的时序鲁棒性：对参考解逐位做「插入一拍 W」与「删去一拍」
 *      的单点扰动，统计仍能通关的扰动数。两版同口径比较，
 *      差值即守卫锁死的时序自由度。
 *
 * 用法：node tools/guard_evidence.js
 * ========================================================= */
'use strict';

const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');
const { solve } = require('./solver.js');
const audit = require('./audit.js');

const LV = LEVELS.find(l => l.id === 15);
const st0 = Engine.getStatic(LV);
/* 咽喉格 = A 门正下方那一格；由地图推导，不硬编码坐标 */
const THROAT = { x: st0.doors.A[0].x, y: st0.doors.A[0].y + 1 };

function stripGuards(lv) {
  return Object.assign({}, lv, {
    map: lv.map.map(row => row.replace(/[\u2190\u2191\u2192\u2193]/g, '.')),
    solution: null
  });
}

/** 回放动作串，返回终态与玩家首次踏入咽喉的拍号 */
function replay(lv, acts) {
  const s = Engine.create(lv);
  let throatAt = -1;
  for (let i = 0; i < acts.length; i++) {
    Engine.applyAction(s, acts[i]);
    if (throatAt < 0 && s.player.x === THROAT.x && s.player.y === THROAT.y) throatAt = i + 1;
    if (s.status !== 'playing') break;
  }
  return { status: s.status, step: s.step, throatAt };
}

/** 单点扰动：插入一拍等待 / 删去一拍，统计仍能通关的条数 */
function perturbationWidth(lv, acts) {
  const details = { insert: 0, remove: 0, total: 0 };
  for (let i = 0; i <= acts.length; i++) {
    const variant = acts.slice(0, i) + 'W' + acts.slice(i);
    details.total++;
    if (replay(lv, variant).status === 'won') details.insert++;
  }
  for (let i = 0; i < acts.length; i++) {
    const variant = acts.slice(0, i) + acts.slice(i + 1);
    details.total++;
    if (replay(lv, variant).status === 'won') details.remove++;
  }
  return details;
}

function main() {
  const noGuard = stripGuards(LV);
  console.log('\n=== L15 守卫解题作用量化 ===\n');
  console.log(`守卫初始：${JSON.stringify(st0.guardStart)}`);
  console.log(`参考解  ：${LV.solution}（${LV.solution.length} 步，par ${LV.par}）`);

  const aG = audit.auditLevel(LV);
  const aN = audit.auditLevel(noGuard);
  console.log(`\n[G] 割集   有守卫 ${aG.gPass ? '✓' : '✗'} / 无守卫 ${aN.gPass ? '✓' : '✗'}`);
  console.log(`[N] 必要性 有守卫 ${aG.nPass ? '✓' : '✗'} / 无守卫 ${aN.nPass ? '✓' : '✗'}`);

  const base = replay(LV, LV.solution);
  const baseN = replay(noGuard, LV.solution);
  console.log(`\n[A] 参考解回放：有守卫 ${base.status} / 无守卫 ${baseN.status}；首次踏入咽喉 = 第 ${base.throatAt} 拍`);

  const sN = solve(noGuard, { needStars: true, budgetMs: 90000, maxNodes: 2500000 });
  console.log(`    无守卫最短全收集：${sN.ok ? sN.steps + ' 步  ' + sN.actions : '未找到（' + sN.reason + '）'}` +
    `（有守卫 ${LV.solution.length} 步）`);

  // [B] 咽喉前插入一拍等待
  const p = base.throatAt - 1;
  const delayed = LV.solution.slice(0, p) + 'W' + LV.solution.slice(p);
  const dG = replay(LV, delayed);
  const dN = replay(noGuard, delayed);
  console.log(`\n[B] 咽喉前多等一拍：${delayed}`);
  console.log(`    有守卫 → ${dG.status}（第 ${dG.step} 拍）   无守卫 → ${dN.status}`);

  // [C] 单点扰动鲁棒性（同一扰动串，两版同口径）
  const wG = perturbationWidth(LV, LV.solution);
  const wN = perturbationWidth(noGuard, LV.solution);
  console.log(`\n[C] 单点扰动可通关数 / ${wG.total} 条`);
  console.log(`    有守卫 ${wG.insert + wG.remove}（插 W ${wG.insert} / 删拍 ${wG.remove}）`);
  console.log(`    无守卫 ${wN.insert + wN.remove}（插 W ${wN.insert} / 删拍 ${wN.remove}）`);

  const guardMatters =
    st0.guardStart.length >= 1 &&
    aG.pass && aN.pass &&
    base.status === 'won' &&
    dG.status !== 'won' && dN.status === 'won' &&
    (wN.insert + wN.remove) > (wG.insert + wG.remove);

  console.log('\n结论：' + (guardMatters
    ? '✓ 守卫确实锁死了咽喉通过拍，并收窄了可行时序（不是装饰）'
    : '✗ 未能量化出守卫的解题作用，需重新设计') + '\n');

  const out = {
    guards: st0.guardStart, solution: LV.solution, par: LV.par,
    throatStep: base.throatAt,
    audit: { withGuard: aG.pass, noGuard: aN.pass },
    shortestNoGuard: sN.ok ? { steps: sN.steps, actions: sN.actions } : null,
    delayed: { actions: delayed, withGuard: dG.status, noGuard: dN.status },
    perturbation: { total: wG.total, withGuard: wG, noGuard: wN },
    guardMatters
  };
  require('fs').writeFileSync(__dirname + '/guard-evidence.json', JSON.stringify(out, null, 2));
  return guardMatters ? 0 : 1;
}

if (require.main === module) process.exit(main());
module.exports = { stripGuards, replay, perturbationWidth, main };
