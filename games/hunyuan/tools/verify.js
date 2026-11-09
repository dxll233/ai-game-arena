/* =========================================================
 * tools/verify.js —— 第二轮关卡 / 状态校验（B2）
 *
 * 对每一关回放 js/levels.js 中内置的 solution，断言：
 *   1. 地图结构合法（矩形、S/E 唯一、门板配对、字符合法、锚点/尖刺板）
 *   2. 回放过程中没有死亡，结束时 status === 'won'
 *   3. 步数 <= par（三星阈值可达）且参考解没有多余动作
 *   4. 星尘 / 时间水晶全部收集（星级与胜利条件一致）
 *   5. 同一参考解重播两次结果逐字段一致（确定性）
 *   6. 撤销回放：连续动作后逐个撤销，状态与初始逐字段一致；
 *      撤销胜利动作恢复 playing 且逐字段等于胜利前快照
 *   7. 含时间锚的关卡：参考解确实触发 anchorSet / anchorApplied，
 *      且把锚点字符去除后同一动作串不再通关（机制为解题必要条件）
 *
 * 用法：node tools/verify.js
 * ========================================================= */
'use strict';

const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');
const audit = require('./audit.js');
const VERSION = 'ECHO Round3';

let failures = 0;
const rows = [];

function fail(lv, msg) {
  failures++;
  console.log(`  ✗ ${msg}`);
}
function ok(msg) { console.log('  ✓ ' + msg); }
function serialize(s) {
  return JSON.stringify(s, (k, v) => (k === 'def' ? undefined : v));
}
const ALLOWED = /^[#.SE*xa-dA-Do^!↑↓←→]+$/;

console.log(`\n=== 《回响》关卡校验 ===\n版本：${VERSION} | 关卡数：${LEVELS.length}\n`);

for (const lv of LEVELS) {
  console.log(`第 ${lv.id} 关《${lv.name}》 T=${lv.echoEvery} M=${lv.maxEchoes} par=${lv.par}`);

  // --- 结构检查 ---
  let state = null;
  try {
    if (lv.map.some(r => typeof r !== 'string' || !ALLOWED.test(r))) throw new Error('含非法字符');
    const w = lv.map[0].length;
    if (lv.map.some(r => r.length !== w)) throw new Error('行长度不一致');
    state = Engine.create(lv);
  } catch (e) {
    fail(lv, '地图解析失败：' + e.message);
    continue;
  }
  if (!lv.solution) { fail(lv, '缺少参考解 solution'); continue; }
  if (!/^[UDLRW]+$/.test(lv.solution)) { fail(lv, 'solution 含非法字符'); continue; }

  // --- 机关必要性（防止「直接走过去就通关」的关卡设计回归）---
  const necessity = audit.auditLevel(lv);
  if (!necessity.tutorial) {
    if (!necessity.gPass) {
      fail(lv, `[G] 门不是割集：关闭所有门仍可 ${necessity.g.steps} 步绕到出口（${necessity.g.path}）`);
    }
    if (!necessity.nPass) {
      fail(lv, `[N] 禁用全部回响仍可 ${necessity.n.steps} 步通关（${necessity.n.actions}），机制非必要`);
    }
  }

  // --- 回放 ---
  let died = false, deathStep = -1;
  const eventsSeen = {};
  for (let i = 0; i < lv.solution.length; i++) {
    const r = Engine.applyAction(state, lv.solution[i]);
    for (const ev of r.events) eventsSeen[ev.type] = (eventsSeen[ev.type] || 0) + 1;
    if (state.status === 'dead') { died = true; deathStep = i + 1; break; }
    if (state.status === 'won') break;
  }

  if (died) {
    fail(lv, `参考解在第 ${deathStep} 拍阵亡（${state.deathCause}）`);
    console.log(Engine.ascii(state));
    continue;
  }
  if (state.status !== 'won') {
    fail(lv, `参考解走完后未通关（状态 ${state.status}）`);
    console.log(Engine.ascii(state));
    continue;
  }

  const starsGot = state.stars.filter(s => s.taken).length;
  const crystalsGot = state.crystals.filter(c => c.taken).length;
  if (state.step > lv.par) fail(lv, `参考解 ${state.step} 步 > par ${lv.par}`);
  if (state.step !== lv.solution.length) fail(lv, `参考解含多余动作（实际 ${state.step} 步 / 串长 ${lv.solution.length}）`);
  if (starsGot !== state.stars.length) fail(lv, `参考解未集齐星尘 ${starsGot}/${state.stars.length}`);
  if (crystalsGot !== state.crystals.length) fail(lv, `参考解未集齐时间水晶 ${crystalsGot}/${state.crystals.length}`);

  // --- 确定性重播 ---
  const s2 = Engine.create(lv);
  for (let i = 0; i < lv.solution.length; i++) { Engine.applyAction(s2, lv.solution[i]); if (s2.status !== 'playing') break; }
  if (serialize(s2) !== serialize(state)) fail(lv, '同一参考解重播两次结果不一致');

  // --- 撤销回放（B2 第 5 条）---
  const serial = s => serialize(s);
  const initial = serial(Engine.create(lv));
  const s3 = Engine.create(lv);
  const stack = [];
  const probe = lv.solution.slice(0, 12);
  for (const ch of probe) {
    stack.push(Engine.clone(s3));
    Engine.applyAction(s3, ch);
    if (s3.status !== 'playing') break;
  }
  while (stack.length) { const snap = stack.pop(); Object.keys(snap).forEach(k => { if (k !== 'def') s3[k] = snap[k]; }); }
  if (serial(s3) !== initial) fail(lv, '连续动作后逐个撤销，状态未逐字段恢复到初始');

  // 撤销胜利动作
  const s4 = Engine.create(lv);
  let beforeWin = null;
  for (const ch of lv.solution) {
    beforeWin = Engine.clone(s4);
    Engine.applyAction(s4, ch);
    if (s4.status !== 'playing') break;
  }
  if (s4.status === 'won') {
    Object.keys(beforeWin).forEach(k => { if (k !== 'def') s4[k] = beforeWin[k]; });
    if (s4.status !== 'playing' || serial(s4) !== serial(beforeWin)) {
      fail(lv, '撤销胜利动作后状态未完整恢复');
    }
  }

  // --- 锚点必要性（B1）---
  const hasAnchor = lv.map.join('').indexOf('^') >= 0;
  if (hasAnchor) {
    if (!eventsSeen.anchorSet || !eventsSeen.anchorApplied) {
      fail(lv, `参考解未触发锚点机制（anchorSet=${eventsSeen.anchorSet || 0}, anchorApplied=${eventsSeen.anchorApplied || 0}）`);
    }
    const noAnchor = Object.assign({}, lv, { map: lv.map.map(r => r.replace(/\^/g, '.')) });
    const s5 = Engine.create(noAnchor);
    for (const ch of lv.solution) { Engine.applyAction(s5, ch); if (s5.status !== 'playing') break; }
    if (s5.status === 'won') fail(lv, '去掉时间锚后同一参考解仍能通关（机制非必要）');
  }

  rows.push({
    关卡: `第 ${lv.id} 关《${lv.name}》`,
    T: lv.echoEvery, M: lv.maxEchoes,
    参考解步数: state.step, par: lv.par,
    星尘: `${starsGot}/${state.stars.length}`,
    水晶: `${crystalsGot}/${state.crystals.length}`,
    锚点: hasAnchor ? `${eventsSeen.anchorApplied || 0} 次生效` : '—',
    结果: '通过'
  });
  ok(`${state.step} 步通关，par=${lv.par}，星尘 ${starsGot}/${state.stars.length}，水晶 ${crystalsGot}/${state.crystals.length}` +
     (hasAnchor ? `，锚生效 ${eventsSeen.anchorApplied || 0} 次` : ''));
}

if (rows.length) {
  console.log('\n--- 汇总 ---');
  console.table(rows);
}

if (failures) {
  console.log(`\n✗ ${failures} 项校验失败（版本 ${VERSION}，共 ${LEVELS.length} 关）\n`);
  process.exit(1);
} else {
  console.log(`\n✓ 版本 ${VERSION}：全部 ${LEVELS.length} 关参考解、星尘/水晶、撤销回放与锚点必要性校验通过\n`);
}
