/* =========================================================
 * 《回响 / ECHO》 Canvas 渲染层
 * 逻辑坐标 -> 渲染坐标做指数缓动插值，视觉上连续、逻辑上仍是离散回合
 * ========================================================= */
(function (root) {
  'use strict';

  var COL = {
    boardBg: '#111629',
    boardEdge: 'rgba(255,255,255,0.07)',
    grid: 'rgba(255,255,255,0.045)',
    floor: '#1a2038',
    wall: '#2d3757',
    wallTop: '#3b4874',
    wallSide: '#232c48',
    plate: '#e0a83c',
    plateOn: '#ffd76a',
    door: '#f72585',
    doorOpen: 'rgba(247,37,133,0.16)',
    exit: '#4cc9f0',
    exitLock: '#4a5a75',
    star: '#ffe066',
    crystal: '#2de2c8',
    anchor: '#2de2c8',
    anchorOn: '#ffd76a',
    spike: '#ff5d73',
    guard: '#ff7a6b',
    echo: '#a06bff',
    echoFrozen: '#8b7bff',
    player: '#48e5ff',
    text: '#e8ecf7'
  };

  var canvas = null, ctx = null;
  var cell = 34, ox = 0, oy = 0, W = 0, H = 0, dpr = 1;
  var views = {};          // key -> {x, y} 渲染坐标（格坐标，浮点）
  var particles = [];
  var twinkles = [];
  var boardBox = null;
  var lastState = null;    // 最近一帧 draw 的状态，供只读自检 diagnostics() 使用

  function init(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(320, rect.width || 640);
    var cssH = Math.max(240, rect.height || 420);
    dpr = Math.min(2.5, root.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    W = cssW; H = cssH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  root.addEventListener('resize', resizeCanvas);

  function layout(state) {
    if (!state) return;
    var pad = 18;
    var availW = W - pad * 2, availH = H - pad * 2;
    cell = Math.floor(Math.min(availW / state.cols, availH / state.rows));
    cell = Math.max(16, Math.min(52, cell));
    ox = Math.round((W - cell * state.cols) / 2);
    oy = Math.round((H - cell * state.rows) / 2);
    boardBox = { x: ox, y: oy, w: cell * state.cols, h: cell * state.rows };
    if (twinkles.length === 0) {
      for (var i = 0; i < 46; i++) {
        twinkles.push({
          x: Math.random(), y: Math.random(),
          r: 0.6 + Math.random() * 1.5,
          p: Math.random() * Math.PI * 2,
          s: 0.4 + Math.random() * 1.2
        });
      }
    }
  }

  /* ---------- 粒子 ---------- */
  function burst(gx, gy, color, n, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.4 + Math.random()) * (power || 1);
      particles.push({
        x: gx, y: gy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1.4 + Math.random() * 1.4,
        color: color, size: 1.2 + Math.random() * 2.2
      });
    }
  }

  function consumeEvents(state, events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'echoBorn': burst(e.x, e.y, COL.echo, 16, 1.1); break;
        case 'echoFroze': burst(e.x, e.y, COL.echoFrozen, 12, 0.8); break;
        case 'echoShatter': burst(e.x, e.y, COL.guard, 18, 1.5); break;
        case 'echoExpired': burst(e.x, e.y, 'rgba(255,255,255,0.5)', 8, 0.6); break;
        case 'star': burst(e.x, e.y, COL.star, 14, 1.0); break;
        case 'crystal': burst(e.x, e.y, COL.crystal, 22, 1.4); break;
        case 'anchorSet': burst(e.x, e.y, COL.anchorOn, 20, 1.2); break;
        case 'anchorApplied': burst(e.x, e.y, COL.anchorOn, 26, 1.5); break;
        case 'anchorIgnored': burst(e.x, e.y, 'rgba(160,170,190,0.6)', 8, 0.6); break;
        case 'win': burst(state.player.x, state.player.y, COL.exit, 34, 1.8); break;
        case 'die': burst(state.player.x, state.player.y, COL.spike, 26, 1.6); break;
        default: break;
      }
    }
  }

  /* ---------- 插值 ---------- */
  function view(key, x, y, dt, snap) {
    var v = views[key];
    if (!v) { v = views[key] = { x: x, y: y }; }
    if (snap) { v.x = x; v.y = y; return v; }
    var k = 1 - Math.exp(-dt / 0.045);
    v.x += (x - v.x) * k;
    v.y += (y - v.y) * k;
    return v;
  }

  function prune(keys) {
    for (var k in views) {
      if (keys.indexOf(k) < 0) delete views[k];
    }
  }

  /* ---------- 坐标变换（第二轮 A0：唯一入口） ----------
   * 历史缺陷：旧版只有 px(gx)=ox+gx*cell+cell/2，实体把纵坐标也用它，
   * 而墙/板/出口用 oy+y*cell，纵向漂移 ox-oy。
   * 现在所有「格坐标 -> CSS 像素」一律走 gridToScreen / screenX / screenY。
   */
  function screenX(gx) { return ox + gx * cell + cell / 2; }
  function screenY(gy) { return oy + gy * cell + cell / 2; }
  function gridToScreen(x, y) { return { x: screenX(x), y: screenY(y) }; }
  function cellBox(x, y) { return { x: ox + x * cell, y: oy + y * cell }; }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------- 主绘制 ---------- */
  function draw(state, dt, prediction) {
    if (!ctx || !state) return;
    lastState = state;
    var st0 = root.EchoEngine.getStatic(state.def);
    layout(state);
    dt = Math.min(0.05, Math.max(0, dt));

    var t = performance.now() / 1000;

    // 背景
    ctx.fillStyle = '#0b0f1d';
    ctx.fillRect(0, 0, W, H);
    drawTwinkles(t);

    // 棋盘底
    ctx.fillStyle = COL.boardBg;
    roundRect(ctx, ox - 8, oy - 8, cell * state.cols + 16, cell * state.rows + 16, 14);
    ctx.fill();
    ctx.strokeStyle = COL.boardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    var open = root.EchoEngine.evaluateDoors(state);

    // 地板 & 网格
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        var tile = st0.tiles[y][x];
        var b = cellBox(x, y), bx = b.x, by = b.y;
        if (tile.wall) continue;
        ctx.fillStyle = COL.floor;
        roundRect(ctx, bx + 1, by + 1, cell - 2, cell - 2, Math.min(6, cell * 0.16));
        ctx.fill();
      }
    }
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx <= state.cols; gx++) {
      ctx.moveTo(ox + gx * cell + 0.5, oy);
      ctx.lineTo(ox + gx * cell + 0.5, oy + state.rows * cell);
    }
    for (var gy = 0; gy <= state.rows; gy++) {
      ctx.moveTo(ox, oy + gy * cell + 0.5);
      ctx.lineTo(ox + state.cols * cell, oy + gy * cell + 0.5);
    }
    ctx.stroke();

    drawTiles(state, st0, open, t);
    drawSpawnHint(state, t);
    drawEchoPaths(state);
    drawEntities(state, dt, t);
    if (prediction) drawPrediction(state, t, prediction);
    drawParticles(dt);
  }

  /* ---------- 时间望远镜叠加层（第三轮核心升级） ----------
   * 只画「引擎保证确定」的信息，不做任何猜测：
   *  · 青色双环准星 = 该残像重演完毕后将定格的格子；
   *  · ✕ 标记 = 该残像途中会被守卫撞碎（预测失败即资源损失预警）；
   *  · ⊘ 标记 = 该残像会因数量超限被挤出（未定格就消失）；
   *  · 紫色虚线菱形 = 下一只残像的出生点（若被时间锚改写，显示金色外环）；
   *  · 玩家周围红色脉冲 = 若原地不动，会在第 N 拍死亡。
   */
  function drawPrediction(state, t, pr) {
    var PCOL = 'rgba(155,232,255,';
    // ① 在场残像的冻结点
    for (var i = 0; i < pr.echoFutures.length; i++) {
      var f = pr.echoFutures[i];
      var owner = null;
      for (var k = 0; k < state.echoes.length; k++) {
        if (state.echoes[k].id === f.id) { owner = state.echoes[k]; break; }
      }
      if (!owner || owner.done) continue;
      var ePos = gridToScreen(owner.x, owner.y);
      if (f.shattered || f.expired) {
        ctx.save();
        ctx.strokeStyle = f.shattered ? 'rgba(255,122,107,0.9)' : 'rgba(200,205,220,0.8)';
        ctx.lineWidth = 1.6;
        var r = cell * 0.16, cx = ePos.x, cy = ePos.y - cell * 0.34;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (!f.freeze) continue;
      var c = gridToScreen(f.freeze.x, f.freeze.y);
      var pulse = 0.75 + 0.25 * Math.sin(t * 2.4 + i);
      ctx.save();
      ctx.strokeStyle = PCOL + (0.9 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.arc(c.x, c.y, cell * 0.33, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, cell * 0.20, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 十字准星刻线
      var q = cell * 0.42;
      ctx.beginPath();
      ctx.moveTo(c.x - q, c.y); ctx.lineTo(c.x - q * 0.62, c.y);
      ctx.moveTo(c.x + q * 0.62, c.y); ctx.lineTo(c.x + q, c.y);
      ctx.moveTo(c.x, c.y - q); ctx.lineTo(c.x, c.y - q * 0.62);
      ctx.moveTo(c.x, c.y + q * 0.62); ctx.lineTo(c.x, c.y + q);
      ctx.stroke();
      ctx.restore();
    }
    // ② 下一只残像的出生点
    if (pr.nextEcho) {
      var nc = gridToScreen(pr.nextEcho.from.x, pr.nextEcho.from.y);
      var s = cell * 0.30 * (0.9 + 0.1 * Math.sin(t * 3.2));
      ctx.save();
      ctx.strokeStyle = 'rgba(170,120,255,0.95)';
      if (pr.nextEcho.fromAnchor) { ctx.shadowColor = COL.anchorOn; ctx.shadowBlur = 12; }
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(nc.x, nc.y - s); ctx.lineTo(nc.x + s, nc.y);
      ctx.lineTo(nc.x, nc.y + s); ctx.lineTo(nc.x - s, nc.y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      drawLabel('下', nc.x, nc.y, 'rgba(200,170,255,0.95)', cell * 0.26);
    }
    // ③ 原地不动会死亡的预警
    if (pr.danger) {
      var pl = gridToScreen(state.player.x, state.player.y);
      var pulse2 = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,93,115,' + (0.45 + 0.45 * pulse2).toFixed(3) + ')';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, cell * (0.5 + 0.1 * pulse2), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      drawLabel('危险!', pl.x, pl.y - cell * 0.62, 'rgba(255,140,150,0.95)', cell * 0.24);
    }
  }

  function drawTwinkles(t) {
    if (!twinkles.length) return;
    for (var i = 0; i < twinkles.length; i++) {
      var s = twinkles[i];
      var a = 0.18 + 0.16 * Math.sin(t * s.s + s.p);
      ctx.fillStyle = 'rgba(180,205,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTiles(state, st0, open, t) {
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        var tile = st0.tiles[y][x];
        var b = cellBox(x, y), bx = b.x, by = b.y;
        if (tile.wall) {
          ctx.fillStyle = COL.wallSide;
          roundRect(ctx, bx + 1, by + 1, cell - 2, cell - 2, 6);
          ctx.fill();
          ctx.fillStyle = COL.wallTop;
          roundRect(ctx, bx + 3, by + 3, cell - 6, cell - 7, 5);
          ctx.fill();
          continue;
        }

        // 压力板
        if (tile.plate) {
          var pressed = isPlatePressed(state, tile.plate);
          var inset = cell * 0.17;
          ctx.save();
          if (pressed) {
            ctx.shadowColor = COL.plateOn;
            ctx.shadowBlur = cell * 0.55;
          }
          ctx.fillStyle = pressed ? COL.plateOn : 'rgba(224,168,60,0.30)';
          roundRect(ctx, bx + inset, by + inset, cell - inset * 2, cell - inset * 2, cell * 0.16);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = pressed ? '#fff1c9' : 'rgba(224,168,60,0.65)';
          ctx.lineWidth = pressed ? 2 : 1.2;
          roundRect(ctx, bx + inset, by + inset, cell - inset * 2, cell - inset * 2, cell * 0.16);
          ctx.stroke();
          drawLabel(tile.plate.toUpperCase(), bx + cell / 2, by + cell / 2, pressed ? '#5a3a00' : 'rgba(224,168,60,0.9)', cell * 0.34);
        }

        // 门
        if (tile.door) {
          var isOpen = !!open[tile.door];
          if (isOpen) {
            ctx.fillStyle = COL.doorOpen;
            roundRect(ctx, bx + 2, by + 2, cell - 4, cell - 4, 5);
            ctx.fill();
            ctx.strokeStyle = 'rgba(247,37,133,0.55)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([4, 4]);
            roundRect(ctx, bx + 2, by + 2, cell - 4, cell - 4, 5);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.fillStyle = COL.door;
            roundRect(ctx, bx + 1, by + 1, cell - 2, cell - 2, 5);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            for (var b = 0; b < 3; b++) {
              var bh = (cell - 8) / 3;
              ctx.fillRect(bx + 4, by + 4 + b * (bh + 2), cell - 8, bh * 0.72);
            }
            drawLabel(tile.door, bx + cell / 2, by + cell / 2, 'rgba(255,255,255,0.85)', cell * 0.32);
          }
        }

        // 尖刺
        if (tile.spike) {
          ctx.fillStyle = 'rgba(255,93,115,0.16)';
          roundRect(ctx, bx + 2, by + 2, cell - 4, cell - 4, 5);
          ctx.fill();
          ctx.fillStyle = COL.spike;
          var spikes = 3, sw = (cell - 10) / spikes;
          for (var i = 0; i < spikes; i++) {
            var sx = bx + 5 + i * sw;
            ctx.beginPath();
            ctx.moveTo(sx, by + cell - 6);
            ctx.lineTo(sx + sw / 2, by + 6);
            ctx.lineTo(sx + sw, by + cell - 6);
            ctx.closePath();
            ctx.fill();
          }
        }

        // 星尘
        if (tile.star) {
          var gotStar = state.stars.some(function (s) { return s.x === x && s.y === y && s.taken; });
          if (!gotStar) {
            var pulse = 0.82 + 0.18 * Math.sin(t * 3 + x + y);
            ctx.save();
            ctx.translate(bx + cell / 2, by + cell / 2);
            ctx.rotate(t * 0.9);
            ctx.shadowColor = COL.star;
            ctx.shadowBlur = 12 * pulse;
            ctx.fillStyle = COL.star;
            star(ctx, 0, 0, cell * 0.2 * pulse, cell * 0.08 * pulse);
            ctx.restore();
          }
        }

        // 时间水晶
        if (tile.crystal) {
          var got = state.crystals.some(function (c) { return c.x === x && c.y === y && c.taken; });
          if (!got) {
            ctx.save();
            ctx.translate(bx + cell / 2, by + cell / 2);
            ctx.rotate(Math.PI / 4);
            ctx.shadowColor = COL.crystal;
            ctx.shadowBlur = 14;
            ctx.fillStyle = COL.crystal;
            var ds = cell * 0.24 * (0.9 + 0.1 * Math.sin(t * 2.4));
            ctx.fillRect(-ds, -ds, ds * 2, ds * 2);
            ctx.restore();
          }
        }

        // 时间锚（第二轮新增机关）：菱形轮廓 + 记录状态
        if (tile.anchor) {
          var isRecorded = !!(state.anchor && state.anchor.x === x && state.anchor.y === y);
          var ac = gridToScreen(x, y);
          var ar = cell * 0.31;
          ctx.save();
          if (isRecorded) { ctx.shadowColor = COL.anchorOn; ctx.shadowBlur = 16; }
          ctx.strokeStyle = isRecorded ? COL.anchorOn : 'rgba(45,226,200,0.55)';
          ctx.lineWidth = isRecorded ? 2.2 : 1.5;
          ctx.beginPath();
          ctx.moveTo(ac.x, ac.y - ar);
          ctx.lineTo(ac.x + ar, ac.y);
          ctx.lineTo(ac.x, ac.y + ar);
          ctx.lineTo(ac.x - ar, ac.y);
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = isRecorded ? 'rgba(255,215,106,0.22)' : 'rgba(45,226,200,0.10)';
          ctx.fill();
          ctx.fillStyle = isRecorded ? COL.anchorOn : COL.crystal;
          ctx.beginPath(); ctx.arc(ac.x, ac.y, cell * 0.075, 0, Math.PI * 2); ctx.fill();
          if (isRecorded) {
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = 'rgba(255,215,106,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(ac.x, ac.y, ar * 1.42, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            drawLabel(String(state.anchor.step), ac.x + cell * 0.33, ac.y - cell * 0.30,
              'rgba(255,225,140,0.95)', cell * 0.22);
          }
          ctx.restore();
        }

        // 出口
        if (tile.exit) {
          var unlocked = state.crystals.every(function (c) { return c.taken; });
          var cx = bx + cell / 2, cy = by + cell / 2;
          ctx.save();
          if (unlocked) {
            ctx.shadowColor = COL.exit;
            ctx.shadowBlur = 20;
          }
          for (var r = 0; r < 3; r++) {
            var rr = cell * (0.34 - r * 0.09) + (unlocked ? Math.sin(t * 2.6 + r) * cell * 0.02 : 0);
            ctx.strokeStyle = unlocked
              ? 'rgba(76,201,240,' + (0.95 - r * 0.22).toFixed(2) + ')'
              : 'rgba(120,140,170,' + (0.5 - r * 0.12).toFixed(2) + ')';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(2, rr), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
          if (!unlocked) {
            ctx.fillStyle = 'rgba(230,238,252,0.75)';
            ctx.font = 'bold ' + Math.round(cell * 0.34) + 'px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('锁', cx, cy + cell * 0.30);
          }
        }
      }
    }
  }

  function drawLabel(txt, cx, cy, color, size) {
    ctx.fillStyle = color;
    ctx.font = 'bold ' + Math.round(size) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, cy);
  }

  function star(c, ox2, oy2, R, r) {
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var ang = (Math.PI / 4) * i;
      var rad = i % 2 === 0 ? R : r;
      var X = ox2 + Math.cos(ang) * rad;
      var Y = oy2 + Math.sin(ang) * rad;
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
    }
    c.closePath();
    c.fill();
  }

  function isPlatePressed(state, ch) {
    var list = root.EchoEngine.getStatic(state.def).plates[ch];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var occ = (state.player.x === p.x && state.player.y === p.y) ||
        state.echoes.some(function (e) { return e.x === p.x && e.y === p.y; });
      if (!occ) return false;
    }
    return list.length > 0;
  }

  /* 下一个回响的出生点预测 —— 关键的教学提示 */
  function nextSpawn(state) {
    var phase = state.step % state.T;
    var next = phase === 0 ? state.step + state.T : state.step + (state.T - phase);
    var idx = next - state.T;
    if (idx < 0 || idx >= state.history.length) return null;
    return { step: next, pos: state.history[idx], remain: next - state.step };
  }

  function drawSpawnHint(state, t) {
    var ns = nextSpawn(state);
    if (!ns) return;
    var sp = gridToScreen(ns.pos.x, ns.pos.y);
    var cx = sp.x, cy = sp.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,107,255,' + (0.35 + 0.25 * Math.sin(t * 3)).toFixed(2) + ')';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* 追赶中回响的剩余轨迹（按顺序，遇墙即止） */
  function echoFuturePath(state, e) {
    var open = root.EchoEngine.evaluateDoors(state);
    var pts = [{ x: e.x, y: e.y }];
    var cx = e.x, cy = e.y;
    for (var i = e.i; i < e.seq.length; i++) {
      var d = root.EchoEngine.DIRS[e.seq[i]];
      var nx = cx + d.dx, ny = cy + d.dy;
      if (root.EchoEngine.tileAt(state, nx, ny) === null) break;
      var tile = root.EchoEngine.tileAt(state, nx, ny);
      var blocked = tile.wall || (tile.door && !open[tile.door]);
      if (blocked) { pts.push({ x: cx, y: cy }); continue; }
      cx = nx; cy = ny;
      pts.push({ x: cx, y: cy });
    }
    return pts;
  }

  function drawEchoPaths(state) {
    for (var i = 0; i < state.echoes.length; i++) {
      var e = state.echoes[i];
      if (e.done) continue;
      var pts = echoFuturePath(state, e);
      if (pts.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(160,107,255,0.34)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      var p0 = gridToScreen(pts[0].x, pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (var p = 1; p < pts.length; p++) {
        var pp = gridToScreen(pts[p].x, pts[p].y);
        ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function drawEntities(state, dt, t) {
    var keys = [];

    // 守卫
    for (var gi = 0; gi < state.guards.length; gi++) {
      var g = state.guards[gi];
      var key = 'g' + gi;
      keys.push(key);
      var vg = view(key, g.x, g.y, dt);
      var gp = gridToScreen(vg.x, vg.y);
      drawGuard(gp.x, gp.y, g.dir, t);
    }

    // 回响
    for (var i = 0; i < state.echoes.length; i++) {
      var e = state.echoes[i];
      var ek = 'e_' + e.id;
      keys.push(ek);
      var ve = view(ek, e.x, e.y, dt);
      var ep = gridToScreen(ve.x, ve.y);
      drawEcho(ep.x, ep.y, e, t, i);
    }

    // 玩家
    keys.push('P');
    var vp = view('P', state.player.x, state.player.y, dt);
    var pl = gridToScreen(vp.x, vp.y);
    drawPlayer(pl.x, pl.y, state, t);

    prune(keys);
  }

  function drawEcho(cx, cy, e, t, idx) {
    var R = cell * 0.30;
    ctx.save();
    if (e.done) {
      var pulse = 0.86 + 0.14 * Math.sin(t * 2.2 + idx);
      ctx.shadowColor = COL.echoFrozen;
      ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(139,123,255,' + (0.30 * pulse).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(160,140,255,' + (0.85 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      // 定格标记
      ctx.strokeStyle = 'rgba(200,190,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.42, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.shadowColor = COL.echo;
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(160,107,255,0.20)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,120,255,0.70)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(232,225,255,0.85)';
    ctx.font = 'bold ' + Math.round(cell * 0.26) + 'px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(idx + 1), cx, cy + 0.5);
    // 「锚生回响」标记：金色外环 + 小菱形，让机制在画面里可观察
    if (e.fromAnchor) {
      ctx.strokeStyle = 'rgba(255,215,106,0.92)';
      ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.62, 0, Math.PI * 2); ctx.stroke();
      var d = cell * 0.075;
      ctx.fillStyle = COL.anchorOn;
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 1.62 - d);
      ctx.lineTo(cx + d, cy - R * 1.62);
      ctx.lineTo(cx, cy - R * 1.62 + d);
      ctx.lineTo(cx - d, cy - R * 1.62);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawGuard(cx, cy, dir, t) {
    var ang = { U: -Math.PI / 2, D: Math.PI / 2, L: Math.PI, R: 0 }[dir] || 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.shadowColor = COL.guard;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COL.guard;
    var R = cell * 0.30;
    ctx.beginPath();
    ctx.moveTo(R, 0);
    ctx.lineTo(-R * 0.72, -R * 0.72);
    ctx.lineTo(-R * 0.36, 0);
    ctx.lineTo(-R * 0.72, R * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 视野提示
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,107,0.35)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * cell * 0.9, cy + Math.sin(ang) * cell * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawPlayer(cx, cy, state, t) {
    // 下一回响倒计时环
    var phase = state.step % state.T;
    var frac = state.T === 0 ? 0 : (phase === 0 ? 1 : phase / state.T);
    ctx.save();
    ctx.strokeStyle = 'rgba(72,229,255,0.20)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(72,229,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = COL.player;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COL.player;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.28 * (1 + 0.03 * Math.sin(t * 4)), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt * p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 3.4;
      p.y += p.vy * dt * 3.4;
      p.vx *= 0.94; p.vy *= 0.94;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      var pp = gridToScreen(p.x, p.y);
      ctx.arc(pp.x, pp.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * A0 渲染坐标断言：比较「实体当前实际绘制中心」与「逻辑格中心」。
   * 稳定帧（插值收敛后）两者误差应 ≤ 1 CSS 像素。
   * 移动插值进行中允许有偏差，因此测试须在稳定帧采样；移动轨迹另测。
   */
  function diagnostics(state) {
    state = state || lastState;          // 不传参则自检当前帧
    var items = [], maxDrift = 0;
    function check(kind, key, lx, ly) {
      var v = views[key];
      if (!v) { items.push({ kind: kind, missing: true }); maxDrift = Infinity; return; }
      var drawn = gridToScreen(v.x, v.y);
      var expected = gridToScreen(lx, ly);
      var d = Math.sqrt(Math.pow(drawn.x - expected.x, 2) + Math.pow(drawn.y - expected.y, 2));
      if (d > maxDrift) maxDrift = d;
      items.push({ kind: kind, logical: lx + ',' + ly, drawn: drawn.x.toFixed(2) + ',' + drawn.y.toFixed(2),
        expected: expected.x.toFixed(2) + ',' + expected.y.toFixed(2), drift: Number(d.toFixed(3)) });
    }
    if (state) {
      check('player', 'P', state.player.x, state.player.y);
      state.guards.forEach(function (g, i) { check('guard', 'g' + i, g.x, g.y); });
      state.echoes.forEach(function (e) { check('echo', 'e_' + e.id, e.x, e.y); });
    }
    // 地格中心一致性（与实体共用同一变换）
    var b = cellBox(2, 3), c = gridToScreen(2, 3);
    var tileDrift = Math.sqrt(Math.pow(c.x - (b.x + cell / 2), 2) + Math.pow(c.y - (b.y + cell / 2), 2));
    if (tileDrift > maxDrift) maxDrift = tileDrift;
    return {
      ok: maxDrift <= 1,
      maxDrift: Number(maxDrift.toFixed(3)),
      tileDrift: Number(tileDrift.toFixed(3)),
      items: items,
      detail: 'maxDrift=' + maxDrift.toFixed(3) + 'px, 实体数=' + items.length
    };
  }

  root.EchoRender = {
    init: init,
    draw: draw,
    resize: resizeCanvas,
    consumeEvents: consumeEvents,
    clearEffects: function () { particles.length = 0; views = {}; },
    metrics: function () { return { cell: cell, ox: ox, oy: oy, W: W, H: H, dpr: dpr, box: boardBox }; },
    gridToScreen: gridToScreen,
    screenX: screenX,
    screenY: screenY,
    cellBox: cellBox,
    diagnostics: diagnostics
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
