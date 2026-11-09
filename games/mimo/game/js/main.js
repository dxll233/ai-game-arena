'use strict';

/* ============ 入口：启动主循环 ============ */

window.addEventListener('load', () => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  window.__game = game; /* 便于调试 */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); /* 钳制防跳帧 */
    last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
