'use strict';
/* 生成独立开发版 dev.html：完整复制正式版 index.html，
   仅注入 T/G 开发调试键与醒目"开发版"标识。
   调试键绝不进入正式发布入口 index.html。
   用法：node tests/make-dev.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'index.html');
const dst = path.join(root, 'dev.html');

let html = fs.readFileSync(src, 'utf8');
if (html.includes("k === 't'") || html.includes('DEV_MARK')) {
  console.error('FAIL: index.html 已包含开发代码，中止生成');
  process.exit(1);
}
html = html.replace('<title>御剑·破晓</title>', '<title>御剑·破晓 · 开发版</title>');
const devInject = `
/* ===== DEV_MARK：开发版专属调试键（仅存在于 dev.html，不随正式版发布） ===== */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  // T：快进60秒（不超过本局时限-0.1）；G：立即获得足够升级经验
  if (game.state === 'playing' && k === 't'){ game.time = Math.min(game.mode.dur - 0.1, game.time + 60); }
  if (game.state === 'playing' && k === 'g'){ gainXp(player.xpNeed); }
});
(function markDev(){
  const d = document.createElement('div');
  d.textContent = '开 发 版 · DEV（T 快进 / G 升级，勿用于成绩）';
  d.style.cssText = 'position:absolute;left:50%;bottom:8px;transform:translateX(-50%);color:#c05a4a;font-size:13px;letter-spacing:3px;z-index:20;pointer-events:none;';
  document.getElementById('stage').appendChild(d);
})();
`;
html = html.replace('requestAnimationFrame(loop);\n\n/* ================================================================\n   十一、受控自动化测试接口',
                    'requestAnimationFrame(loop);\n' + devInject + '\n/* ================================================================\n   十一、受控自动化测试接口');
if (!html.includes('DEV_MARK')) {
  console.error('FAIL: 注入点未找到，请检查 index.html 结构');
  process.exit(1);
}
fs.writeFileSync(dst, html);
console.log('OK: dev.html 已生成（含 T/G 调试键与开发版标识），index.html 保持无调试路径');
