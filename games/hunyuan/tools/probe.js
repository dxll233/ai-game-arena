/* =========================================================
 * tools/probe.js —— 关卡/动作串诊断（开发期工具）
 *
 * 用法：
 *   node tools/probe.js 8                # 回放该关内置参考解，逐步打印
 *   node tools/probe.js 8 "RRRRDDWW..."   # 回放自定义动作串
 *   node tools/probe.js 8 "RRRR" --map    # 每步附 ASCII 局面
 * ========================================================= */
'use strict';
const Engine = require('../js/engine.js');
const LEVELS = require('../js/levels.js');

const id = parseInt(process.argv[2] || '1', 10);
const lv = LEVELS.find(l => l.id === id);
if (!lv) { console.error('找不到关卡 ' + id); process.exit(1); }
const acts = process.argv[3] || lv.solution || '';
const showMap = process.argv.includes('--map');
const st0 = Engine.getStatic(lv);
const s = Engine.create(lv);

console.log(`\n关卡 ${lv.id}《${lv.name}》 T=${lv.echoEvery} M=${lv.maxEchoes} par=${lv.par}`);
console.log(`起点=(${st0.start.x},${st0.start.y}) 出口=(${st0.exit.x},${st0.exit.y}) 板a=${JSON.stringify(st0.plates.a)} 门A=${JSON.stringify(st0.doors.A)}`);
console.log('动作串：' + acts + ' (长度 ' + acts.length + ')\n');
for (let i = 0; i < acts.length; i++) {
  const doorsBefore = Engine.evaluateDoors(s);
  const r = Engine.applyAction(s, acts[i]);
  const ev = r.events.map(e => e.type + (e.x !== undefined ? '@' + e.x + ',' + e.y : '')).join(' ');
  const echos = s.echoes.map(e => e.x + ',' + e.y + (e.done ? 'F' : '~') + (e.fromAnchor ? 'A' : '')).join(' | ');
  console.log(
    `步${String(s.step).padStart(2)} ${acts[i]} @(${s.player.x},${s.player.y}) ` +
    `门[${Object.keys(doorsBefore).filter(k => doorsBefore[k]).join(',') || '-'}] ` +
    `锚=${s.anchor ? s.anchor.x + ',' + s.anchor.y + '@' + s.anchor.step : '-'} ` +
    `像=[${echos}] ${s.status !== 'playing' ? '*** ' + s.status + ' ***' : ''} :: ${ev}`
  );
  if (showMap) console.log(Engine.ascii(s).split('\n').map(l => '    ' + l).join('\n'));
  if (s.status !== 'playing') break;
}
console.log(`\n终局：status=${s.status} step=${s.step} 星尘=${s.stars.filter(x => x.taken).length}/${s.stars.length} 水晶=${s.crystals.filter(x => x.taken).length}/${s.crystals.length}`);
if (s.status !== 'playing') console.log(Engine.ascii(s));
