/*
 * 《长夜点灯》表现层
 * 状态机 / 输入 / Canvas 渲染 / HUD / 音效调度 / 本地记录
 */
(function () {
  'use strict';

  var CORE = window.NightCore;
  var AUDIO = window.NightAudio;
  if (!CORE) {
    throw new Error('NightCore 未加载');
  }

  var B = CORE.BALANCE;
  var W = B.WORLD_W;
  var H = B.WORLD_H;
  var TAU = Math.PI * 2;
  var renderScale = 1;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');

  var $ = function (id) { return document.getElementById(id); };
  var UI = {
    hud: $('hud'),
    hearts: $('hearts'),
    oilFill: $('oilFill'),
    oilValue: $('oilValue'),
    timeCaption: $('timeCaption'),
    timeValue: $('timeValue'),
    lampStatus: $('lampStatus'),
    lampDots: Array.prototype.slice.call(document.querySelectorAll('.lamp-dot')),
    finaleMeter: $('finaleMeter'),
    finaleFill: $('finaleFill'),
    scoreValue: $('scoreValue'),
    objective: $('objective'),
    objectiveText: $('objectiveText'),
    modeChip: $('modeChip'),
    stageDots: $('stageDots'),
    stageDotNodes: Array.prototype.slice.call(document.querySelectorAll('#stageDots i')),
    toast: $('toast'),
    hint: $('hint'),
    hintText: $('hintText'),
    interactPrompt: $('interactPrompt'),
    interactText: $('interactText'),
    interactFill: $('interactFill'),
    pauseBtn: $('pauseBtn'),
    muteBtn: $('muteBtn'),
    screenTitle: $('screenTitle'),
    screenIntro: $('screenIntro'),
    screenHelp: $('screenHelp'),
    screenPause: $('screenPause'),
    screenDefeat: $('screenDefeat'),
    screenVictory: $('screenVictory'),
    bestRecord: $('bestRecord'),
    titleMuteBtn: $('titleMuteBtn'),
    expeditionBtn: $('expeditionBtn'),
    prepModeShort: $('prepModeShort'),
    prepModeExpedition: $('prepModeExpedition'),
    prepModeNote: $('prepModeNote'),
    prepSummary: $('prepSummary'),
    mapChoices: $('mapChoices'),
    lighthouseChoices: $('lighthouseChoices'),
    introControls: $('introControls'),
    touchUI: $('touchUI'),
    moveStick: $('moveStick'),
    aimStick: $('aimStick'),
    dashBtn: $('dashBtn'),
    interactBtn: $('interactBtn'),
    interactBtnLabel: $('interactBtnLabel'),
    pauseLit: $('pauseLit'),
    pauseTime: $('pauseTime'),
    pauseMode: $('pauseMode'),
    shakeBtn: $('shakeBtn'),
    defeatCause: $('defeatCause'),
    defeatMode: $('defeatMode'),
    victoryMode: $('victoryMode'),
    defeatLit: $('defeatLit'),
    defeatKills: $('defeatKills'),
    defeatTime: $('defeatTime'),
    defeatScore: $('defeatScore'),
    victoryText: $('victoryText'),
    victoryTime: $('victoryTime'),
    victoryKills: $('victoryKills'),
    victoryOil: $('victoryOil'),
    victoryScore: $('victoryScore'),
    victoryRecordLine: $('victoryRecordLine'),
    newRecord: $('newRecord'),
    damageFlash: $('damageFlash'),
    rotateHint: $('rotateHint'),
    rotateCloseBtn: $('rotateCloseBtn')
  };

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var cssWidth = rect.width > 0 ? rect.width : W;
    var cssHeight = rect.height > 0 ? rect.height : H;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    renderScale = canvas.width / W;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  /* ============================================================
     基础工具
     ============================================================ */

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function formatClock(seconds) {
    var total = Math.max(0, Math.ceil(seconds));
    var minutes = Math.floor(total / 60);
    var secs = total % 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function formatDuration(seconds) {
    return formatClock(Math.max(0, Math.floor(seconds)));
  }

  function makeRng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function safeGet(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      /* 本地文件环境可能禁用存储，游戏继续运行 */
    }
  }

  function recordKeys(mode) {
    if (mode === 'expedition') {
      return { score: 'night_bestScore_expedition', elapsed: 'night_bestElapsed_expedition' };
    }
    return { score: 'night_bestScore', elapsed: 'night_bestElapsed' };
  }

  function loadRecord(mode) {
    var keys = recordKeys(mode || 'short');
    var score = parseInt(safeGet(keys.score, '0'), 10);
    var elapsed = parseInt(safeGet(keys.elapsed, '0'), 10);
    return {
      score: Number.isFinite(score) && score > 0 ? score : 0,
      elapsed: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0
    };
  }

  function saveRecord(record, mode) {
    var keys = recordKeys(mode || 'short');
    safeSet(keys.score, record.score);
    safeSet(keys.elapsed, record.elapsed);
  }

  /* ============================================================
     Canvas 资源：发光贴图 / 背景 / 前景 / 雾
     ============================================================ */

  function makeGlowSprite(size, r, g, b) {
    var sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    var sctx = sprite.getContext('2d');
    var gradient = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.95)');
    gradient.addColorStop(0.16, 'rgba(' + r + ',' + g + ',' + b + ',0.52)');
    gradient.addColorStop(0.46, 'rgba(' + r + ',' + g + ',' + b + ',0.16)');
    gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, size, size);
    return sprite;
  }

  var glowWarm = makeGlowSprite(256, 255, 181, 91);
  var glowPale = makeGlowSprite(256, 255, 229, 180);
  var glowBlue = makeGlowSprite(256, 113, 164, 177);
  var glowPurple = makeGlowSprite(256, 119, 83, 152);
  var glowRed = makeGlowSprite(256, 231, 86, 64);

  function makeFogSprite() {
    var sprite = document.createElement('canvas');
    sprite.width = 512;
    sprite.height = 512;
    var sctx = sprite.getContext('2d');
    var gradient = sctx.createRadialGradient(256, 256, 40, 256, 256, 256);
    gradient.addColorStop(0, 'rgba(149, 180, 183, 0.13)');
    gradient.addColorStop(0.5, 'rgba(124, 158, 163, 0.06)');
    gradient.addColorStop(1, 'rgba(100, 135, 143, 0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, 512, 512);
    return sprite;
  }

  var fogSprite = makeFogSprite();
  var bgCanvas = null;
  var fgCanvas = null;

  function drawCanopy(g, x, y, radius, rnd, color, rim) {
    var layers = 3;
    var i;
    g.save();
    g.translate(x, y);
    for (i = 0; i < layers; i++) {
      var rr = radius * (1 - i * 0.2);
      var points = 9;
      g.beginPath();
      for (var p = 0; p < points; p++) {
        var angle = (p / points) * TAU - Math.PI / 2;
        var wobble = 0.84 + rnd() * 0.26;
        var px = Math.cos(angle) * rr * wobble;
        var py = Math.sin(angle) * rr * 0.82 * wobble;
        if (p === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = i === 0 ? color : (i === 1 ? 'rgba(8, 21, 26, 0.9)' : 'rgba(7, 17, 22, 0.8)');
      g.fill();
      if (i === 0) {
        g.strokeStyle = rim;
        g.lineWidth = 1;
        g.stroke();
      }
    }
    g.restore();
  }

  function drawStone(g, x, y, rx, ry, angle, fill, rim) {
    g.save();
    g.translate(x, y);
    g.rotate(angle || 0);
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, TAU);
    g.fillStyle = fill;
    g.fill();
    if (rim) {
      g.strokeStyle = rim;
      g.lineWidth = 0.7;
      g.stroke();
    }
    g.restore();
  }

  function drawRiverBand(g, map) {
    var river = map.river;
    var y0 = river.yMin;
    var y1 = river.yMax;
    var ice = g.createLinearGradient(0, y0, 0, y1);
    ice.addColorStop(0, 'rgba(18, 43, 50, 0.5)');
    ice.addColorStop(0.24, 'rgba(54, 91, 99, 0.9)');
    ice.addColorStop(0.5, 'rgba(91, 132, 137, 0.76)');
    ice.addColorStop(0.78, 'rgba(43, 78, 86, 0.92)');
    ice.addColorStop(1, 'rgba(11, 29, 36, 0.72)');
    g.save();
    g.beginPath();
    g.moveTo(0, y0 + 12);
    for (var x = 0; x <= W; x += 32) {
      g.lineTo(x, y0 + Math.sin(x * 0.018) * 7 + Math.sin(x * 0.041 + 1.6) * 3);
    }
    g.lineTo(W, y1);
    for (var x2 = W; x2 >= 0; x2 -= 32) {
      g.lineTo(x2, y1 + Math.sin(x2 * 0.015 + 0.7) * 8);
    }
    g.closePath();
    g.fillStyle = ice;
    g.fill();
    g.strokeStyle = 'rgba(203, 235, 231, 0.16)';
    g.lineWidth = 1;
    g.stroke();

    for (var i = 0; i < 34; i++) {
      var fx = (i * 97 + 41) % W;
      var fy = y0 + 9 + ((i * 47) % (y1 - y0 - 18));
      var fw = 10 + (i * 13) % 34;
      g.beginPath();
      g.ellipse(fx, fy, fw, 2 + (i % 4), -0.08, 0, TAU);
      g.fillStyle = i % 3 === 0 ? 'rgba(218, 237, 228, 0.13)' : 'rgba(164, 209, 205, 0.07)';
      g.fill();
    }

    g.setLineDash([18, 28]);
    g.strokeStyle = 'rgba(218, 241, 232, 0.1)';
    g.lineWidth = 1;
    for (var line = 0; line < 3; line++) {
      g.beginPath();
      for (var sx = 0; sx <= W; sx += 12) {
        var sy = y0 + 22 + line * 22 + Math.sin(sx * 0.03 + line * 2) * 4;
        if (sx === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    }
    g.setLineDash([]);

    for (var b = 0; b < map.river.bridges.length; b++) {
      drawIceBridge(g, map.river.bridges[b], y0, y1);
    }
    g.restore();
  }

  function drawIceBridge(g, bridge, y0, y1) {
    var left = bridge.xMin;
    var width = bridge.xMax - bridge.xMin;
    var top = y0 - 26;
    var bottom = y1 + 24;
    g.save();
    g.fillStyle = 'rgba(26, 31, 27, 0.95)';
    g.fillRect(left, top, width, bottom - top);
    g.strokeStyle = 'rgba(178, 157, 112, 0.24)';
    g.lineWidth = 1;
    g.strokeRect(left + 1, top + 1, width - 2, bottom - top - 2);
    for (var y = top + 8; y < bottom; y += 13) {
      g.beginPath();
      g.moveTo(left + 2, y);
      g.lineTo(left + width - 2, y);
      g.strokeStyle = 'rgba(207, 184, 132, 0.1)';
      g.stroke();
    }
    g.fillStyle = 'rgba(198, 220, 207, 0.12)';
    g.fillRect(left + 4, top + 4, 3, bottom - top - 8);
    g.fillRect(left + width - 7, top + 4, 3, bottom - top - 8);
    g.restore();
  }

  function buildBackground(mapConfig) {
    var map = mapConfig || CORE.MAPS.village;
    var bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    var g = bg.getContext('2d');
    var rnd = makeRng(0x51f15e);
    var i;

    var base = g.createLinearGradient(0, 0, 0, H);
    if (map.theme === 'forest') {
      base.addColorStop(0, '#071c1c');
      base.addColorStop(0.48, '#0d2b25');
      base.addColorStop(1, '#091b1a');
    } else if (map.theme === 'river') {
      base.addColorStop(0, '#081b28');
      base.addColorStop(0.48, '#0c2732');
      base.addColorStop(1, '#0a1b23');
    } else {
      base.addColorStop(0, '#0b1d28');
      base.addColorStop(0.48, '#112b30');
      base.addColorStop(1, '#0d2025');
    }
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    var centerGlow = g.createRadialGradient(640, 360, 30, 640, 360, 540);
    centerGlow.addColorStop(0, map.theme === 'forest'
      ? 'rgba(78, 120, 80, 0.34)'
      : map.theme === 'river' ? 'rgba(89, 137, 145, 0.33)' : 'rgba(73, 116, 105, 0.32)');
    centerGlow.addColorStop(0.47, 'rgba(38, 78, 74, 0.16)');
    centerGlow.addColorStop(1, 'rgba(4, 12, 17, 0)');
    g.fillStyle = centerGlow;
    g.fillRect(0, 0, W, H);

    /* 泥地颜色斑块 */
    for (i = 0; i < 110; i++) {
      var px = rnd() * W;
      var py = rnd() * H;
      var rx = 26 + rnd() * 120;
      var ry = 8 + rnd() * 42;
      g.save();
      g.translate(px, py);
      g.rotate(rnd() * TAU);
      g.beginPath();
      g.ellipse(0, 0, rx, ry, 0, 0, TAU);
      g.fillStyle = rnd() < 0.5 ? 'rgba(64, 100, 85, 0.13)' : 'rgba(8, 22, 26, 0.18)';
      g.fill();
      g.restore();
    }

    /* 细小的灰烬与碎石 */
    for (i = 0; i < 1550; i++) {
      var nx = rnd() * W;
      var ny = rnd() * H;
      var size = rnd() < 0.86 ? 0.7 : 1.4;
      g.fillStyle = rnd() < 0.45 ? 'rgba(174, 199, 183, 0.14)' : 'rgba(228, 204, 160, 0.09)';
      g.fillRect(nx, ny, size, size);
    }

    if (map.river) {
      drawRiverBand(g, map);
    }

    /* 通向古灯的小径。冻河地图绕桥而行，林间地图另有一圈环路。 */
    var braziers = map.braziers;
    for (i = 0; i < braziers.length; i++) {
      var target = braziers[i];
      var side = target.x < 640 ? -1 : 1;
      var cx = 640 + side * (80 + rnd() * 80);
      var cy = 360 + (target.y < 360 ? -70 : 70);
      g.beginPath();
      g.moveTo(640, 380);
      if (map.river && target.y > map.river.yMax) {
        var chosenBridge = map.river.bridges[0];
        for (var bridgeIndex = 0; bridgeIndex < map.river.bridges.length; bridgeIndex++) {
          var bridge = map.river.bridges[bridgeIndex];
          var centerX = (bridge.xMin + bridge.xMax) / 2;
          if (Math.abs(centerX - target.x) < Math.abs((chosenBridge.xMin + chosenBridge.xMax) / 2 - target.x)) {
            chosenBridge = bridge;
          }
        }
        var bridgeCenter = (chosenBridge.xMin + chosenBridge.xMax) / 2;
        g.quadraticCurveTo(640 + side * 80, map.river.yMin - 70, bridgeCenter, map.river.yMin - 20);
        g.lineTo(bridgeCenter, map.river.yMax + 24);
        g.quadraticCurveTo(bridgeCenter + side * 30, target.y - 70, target.x, target.y + 18);
      } else {
        g.quadraticCurveTo(cx, cy, target.x, target.y + 18);
      }
      g.strokeStyle = 'rgba(196, 174, 128, 0.065)';
      g.lineWidth = 42;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
      g.strokeStyle = 'rgba(235, 204, 148, 0.075)';
      g.lineWidth = 8;
      g.setLineDash([6, 21]);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(4, 11, 14, 0.14)';
      g.lineWidth = 1;
      g.stroke();
    }

    if (map.theme === 'forest') {
      g.beginPath();
      g.ellipse(640, 360, 330, 236, 0, 0, TAU);
      g.strokeStyle = 'rgba(185, 178, 126, 0.045)';
      g.lineWidth = 24;
      g.stroke();
      g.strokeStyle = 'rgba(214, 196, 142, 0.055)';
      g.lineWidth = 3;
      g.setLineDash([4, 18]);
      g.stroke();
      g.setLineDash([]);
    }

    /* 中央石台 */
    var daisShadow = g.createRadialGradient(640, 376, 28, 640, 376, 136);
    daisShadow.addColorStop(0, 'rgba(0, 0, 0, 0.46)');
    daisShadow.addColorStop(0.7, 'rgba(0, 0, 0, 0.2)');
    daisShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = daisShadow;
    g.beginPath();
    g.ellipse(640, 376, 146, 112, 0, 0, TAU);
    g.fill();

    g.beginPath();
    g.arc(640, 360, 79, 0, TAU);
    g.fillStyle = 'rgba(22, 38, 39, 0.9)';
    g.fill();
    g.strokeStyle = 'rgba(139, 151, 130, 0.16)';
    g.lineWidth = 1.2;
    g.stroke();

    g.beginPath();
    g.arc(640, 360, 67, 0, TAU);
    g.fillStyle = 'rgba(11, 25, 28, 0.92)';
    g.fill();

    /* 石台放射状砖缝 */
    for (i = 0; i < 24; i++) {
      var a = (i / 24) * TAU;
      g.beginPath();
      g.moveTo(640 + Math.cos(a) * 49, 360 + Math.sin(a) * 49);
      g.lineTo(640 + Math.cos(a) * 78, 360 + Math.sin(a) * 78);
      g.strokeStyle = 'rgba(174, 173, 143, 0.075)';
      g.lineWidth = 0.8;
      g.stroke();
    }

    g.beginPath();
    g.arc(640, 360, 50, 0, TAU);
    g.fillStyle = 'rgba(6, 16, 19, 0.94)';
    g.fill();
    g.strokeStyle = 'rgba(196, 175, 125, 0.13)';
    g.stroke();

    /* 四个方向的踏石 */
    for (i = 0; i < 12; i++) {
      var angle = (i / 12) * TAU + 0.14;
      var distance = 96 + rnd() * 16;
      drawStone(
        g,
        640 + Math.cos(angle) * distance,
        360 + Math.sin(angle) * distance * 0.78,
        8 + rnd() * 12,
        4 + rnd() * 6,
        angle,
        'rgba(30, 45, 43, 0.6)',
        'rgba(151, 158, 132, 0.07)'
      );
    }

    /* 杂草与碎石 */
    for (i = 0; i < 240; i++) {
      px = rnd() * W;
      py = 62 + rnd() * (H - 124);
      var d = Math.hypot(px - 640, (py - 360) * 1.15);
      if (d < 92) continue;
      if (rnd() < 0.52) {
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + (rnd() - 0.5) * 8, py - 4 - rnd() * 9, px + (rnd() - 0.5) * 10, py - 8 - rnd() * 9);
        g.strokeStyle = rnd() < 0.3 ? 'rgba(132, 174, 147, 0.24)' : 'rgba(89, 128, 108, 0.2)';
        g.lineWidth = 0.8;
        g.stroke();
      } else {
        drawStone(
          g, px, py, 1.2 + rnd() * 3.8, 0.8 + rnd() * 2.3, rnd() * TAU,
          'rgba(37, 52, 49, 0.55)', 'rgba(143, 154, 133, 0.05)'
        );
      }
    }

    /* 边缘森林：后景层 */
    for (i = 0; i < 38; i++) {
      var bx = rnd() * W;
      var by = rnd() < 0.5 ? -18 - rnd() * 30 : H + 10 + rnd() * 24;
      drawCanopy(g, bx, by, 24 + rnd() * 34, rnd, 'rgba(6, 18, 22, 0.9)', 'rgba(101, 130, 119, 0.09)');
    }
    for (i = 0; i < 18; i++) {
      var ly = 32 + rnd() * (H - 64);
      var lx = rnd() < 0.5 ? -14 - rnd() * 30 : W + 14 + rnd() * 30;
      drawCanopy(g, lx, ly, 28 + rnd() * 37, rnd, 'rgba(6, 17, 21, 0.92)', 'rgba(101, 130, 119, 0.08)');
    }

    if (map.theme === 'forest') {
      for (i = 0; i < 16; i++) {
        var fxc = 120 + rnd() * (W - 240);
        var fyc = 90 + rnd() * (H - 180);
        if (Math.hypot(fxc - 640, fyc - 360) < 275) continue;
        drawCanopy(g, fxc, fyc, 18 + rnd() * 26, rnd, 'rgba(5, 21, 19, 0.66)', 'rgba(90, 139, 104, 0.08)');
      }
      g.strokeStyle = 'rgba(111, 156, 111, 0.12)';
      g.lineWidth = 0.8;
      for (i = 0; i < 90; i++) {
        var gx = 90 + rnd() * (W - 180);
        var gy = 80 + rnd() * (H - 160);
        if (Math.hypot(gx - 640, gy - 360) < 220) continue;
        g.beginPath();
        g.moveTo(gx, gy);
        g.quadraticCurveTo(gx + (rnd() - 0.5) * 12, gy - 8, gx + (rnd() - 0.5) * 16, gy - 14 - rnd() * 14);
        g.stroke();
      }
    }

    if (map.river) {
      g.strokeStyle = 'rgba(153, 187, 164, 0.17)';
      g.lineWidth = 0.9;
      for (i = 0; i < 46; i++) {
        var reedX = 50 + rnd() * (W - 100);
        var bankY = rnd() < 0.5 ? map.river.yMin - 4 - rnd() * 16 : map.river.yMax + 4 + rnd() * 16;
        g.beginPath();
        g.moveTo(reedX, bankY);
        g.quadraticCurveTo(reedX + (rnd() - 0.5) * 7, bankY - 13, reedX + (rnd() - 0.5) * 11, bankY - 22 - rnd() * 10);
        g.stroke();
      }
    }

    /* 细小的枯枝 */
    for (i = 0; i < 24; i++) {
      var tx = 60 + rnd() * (W - 120);
      var ty = 52 + rnd() * (H - 104);
      if (Math.hypot(tx - 640, ty - 360) < 145) continue;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx + 4 + rnd() * 13, ty - 2 - rnd() * 6);
      g.lineTo(tx + 10 + rnd() * 15, ty - 1 + rnd() * 3);
      g.strokeStyle = 'rgba(88, 95, 75, 0.12)';
      g.lineWidth = 1;
      g.stroke();
    }

    /* 一层薄雾 */
    for (i = 0; i < 7; i++) {
      var fx = rnd() * W;
      var fy = rnd() * H;
      var fr = 160 + rnd() * 210;
      var fgGrad = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
      fgGrad.addColorStop(0, 'rgba(125, 155, 154, 0.032)');
      fgGrad.addColorStop(1, 'rgba(125, 155, 154, 0)');
      g.fillStyle = fgGrad;
      g.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
    }

    var vignette = g.createRadialGradient(640, 360, 160, 640, 360, 690);
    vignette.addColorStop(0, 'rgba(1, 6, 10, 0)');
    vignette.addColorStop(0.62, 'rgba(1, 6, 10, 0.08)');
    vignette.addColorStop(1, 'rgba(1, 5, 9, 0.45)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);

    bgCanvas = bg;
  }

  function buildForeground(mapConfig) {
    var map = mapConfig || CORE.MAPS.village;
    var fg = document.createElement('canvas');
    fg.width = W;
    fg.height = H;
    var g = fg.getContext('2d');
    var rnd = makeRng(0x88b00d);
    var i;

    var canopyCount = map.theme === 'forest' ? 23 : 17;
    for (i = 0; i < canopyCount; i++) {
      var x = 20 + rnd() * (W - 40);
      var y = rnd() < 0.55 ? -26 + rnd() * 34 : H + 18 - rnd() * 34;
      drawCanopy(g, x, y, 38 + rnd() * 44, rnd, 'rgba(3, 10, 14, 0.78)', 'rgba(96, 124, 115, 0.06)');
    }

    for (i = 0; i < 9; i++) {
      var side = rnd() < 0.5;
      x = side ? -22 + rnd() * 42 : W + 22 - rnd() * 42;
      y = 70 + rnd() * (H - 140);
      drawCanopy(g, x, y, 29 + rnd() * 33, rnd, 'rgba(3, 10, 14, 0.72)', 'rgba(96, 124, 115, 0.05)');
    }

    /* 画框般的枯枝 */
    g.strokeStyle = 'rgba(3, 9, 12, 0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 62);
    g.bezierCurveTo(60, 70, 98, 62, 132, 88);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(52, 66);
    g.lineTo(74, 49);
    g.moveTo(91, 68);
    g.lineTo(112, 54);
    g.stroke();

    fgCanvas = fg;
  }

  function prepareMapVisuals(mapId) {
    var map = CORE.MAPS[mapId] || CORE.MAPS.village;
    buildBackground(map);
    buildForeground(map);
  }

  /* ============================================================
     粒子与浮字
     ============================================================ */

  var particles = [];
  var shockwaves = [];
  var floaters = [];
  var titleMotes = [];
  var MAX_PARTICLES = 420;

  function addParticle(type, x, y, options) {
    if (particles.length >= MAX_PARTICLES) return null;
    options = options || {};
    var life = options.life === undefined ? 1 : options.life;
    var particle = {
      type: type,
      x: x,
      y: y,
      vx: options.vx || 0,
      vy: options.vy || 0,
      gravity: options.gravity || 0,
      drag: options.drag === undefined ? 0.98 : options.drag,
      life: life,
      maxLife: life,
      size: options.size === undefined ? 2 : options.size,
      alpha: options.alpha === undefined ? 1 : options.alpha,
      color: options.color || null,
      wobble: options.wobble || 0,
      seed: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 4
    };
    particles.push(particle);
    return particle;
  }

  function burst(x, y, count, type, spread, speed) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * TAU;
      var velocity = speed * (0.25 + Math.random() * 0.9);
      addParticle(type, x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, {
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - (type === 'ember' ? 16 : 0),
        gravity: type === 'ember' ? -6 : type === 'spark' ? 80 : 0,
        life: type === 'ember' ? 0.8 + Math.random() * 1.4 : type === 'smoke' ? 1.2 + Math.random() * 1.2 : 0.25 + Math.random() * 0.5,
        size: type === 'smoke' ? 8 + Math.random() * 14 : 1 + Math.random() * 2.4,
        drag: type === 'smoke' ? 0.94 : 0.97
      });
    }
  }

  function addShockwave(x, y, maxRadius, life, color) {
    shockwaves.push({
      x: x,
      y: y,
      radius: 8,
      maxRadius: maxRadius,
      life: life,
      maxLife: life,
      color: color || 'rgba(255, 193, 104, '
    });
  }

  function addFloater(x, y, text, color) {
    floaters.push({
      x: x,
      y: y,
      text: text,
      color: color || '#ffd28c',
      life: 1.1,
      maxLife: 1.1
    });
  }

  function updateParticles(dt, factor) {
    factor = factor === undefined ? 1 : factor;
    var i;
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt * factor;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt * factor;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt * factor;
      p.y += p.vy * dt * factor;
      p.seed += p.spin * dt;
      if (p.wobble) {
        p.x += Math.sin(p.seed + p.life * 2) * p.wobble * dt;
      }
    }

    for (i = shockwaves.length - 1; i >= 0; i--) {
      var wave = shockwaves[i];
      wave.life -= dt;
      var progress = 1 - wave.life / wave.maxLife;
      wave.radius = 8 + wave.maxRadius * (1 - Math.pow(1 - progress, 2));
      if (wave.life <= 0) shockwaves.splice(i, 1);
    }

    for (i = floaters.length - 1; i >= 0; i--) {
      var floater = floaters[i];
      floater.life -= dt;
      floater.y -= dt * 24;
      if (floater.life <= 0) floaters.splice(i, 1);
    }
  }

  function drawParticles(g) {
    var i;
    g.save();
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      var t = p.life / p.maxLife;
      if (p.type === 'smoke') {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = t * 0.24 * p.alpha;
        g.fillStyle = p.color || '#45314f';
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.8 - t * 0.8), 0, TAU);
        g.fill();
      } else if (p.type === 'dust') {
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = t * 0.18 * p.alpha;
        g.fillStyle = '#c7d7c5';
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, TAU);
        g.fill();
      } else if (p.type === 'spark') {
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = t * p.alpha;
        g.strokeStyle = p.color || '#ffd28b';
        g.lineWidth = p.size * 0.7;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        g.stroke();
      } else if (p.type === 'beam-mote') {
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = t * 0.6 * p.alpha;
        g.fillStyle = '#ffe5b4';
        g.beginPath();
        g.arc(p.x, p.y, p.size * 0.7, 0, TAU);
        g.fill();
      } else {
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = t * p.alpha;
        g.drawImage(glowWarm, p.x - p.size * 4, p.y - p.size * 4, p.size * 8, p.size * 8);
        g.globalAlpha = t * 0.9 * p.alpha;
        g.fillStyle = '#ffe6b3';
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, p.size * 0.55), 0, TAU);
        g.fill();
      }
    }
    g.restore();

    g.save();
    for (i = 0; i < shockwaves.length; i++) {
      var wave = shockwaves[i];
      var alpha = Math.max(0, wave.life / wave.maxLife);
      g.strokeStyle = wave.color + (alpha * 0.42) + ')';
      g.lineWidth = 1.2 + alpha * 1.2;
      g.beginPath();
      g.arc(wave.x, wave.y, wave.radius, 0, TAU);
      g.stroke();
    }
    g.restore();

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (i = 0; i < floaters.length; i++) {
      var floater = floaters[i];
      var fa = Math.min(1, floater.life / 0.4);
      g.globalAlpha = fa;
      g.fillStyle = floater.color;
      g.font = '500 13px "Songti SC", "STSong", serif';
      g.fillText(floater.text, floater.x, floater.y);
    }
    g.restore();
  }

  /* ============================================================
     应用状态
     ============================================================ */

  var appState = 'title'; /* title | intro | playing | paused | ending | defeat | victory */
  var gameState = null;
  var helpOpen = false;
  var endKind = null;
  var endTimer = 0;
  var resultRecorded = false;
  var lastDefeatReason = 'health';
  var muted = safeGet('night_muted', '0') === '1';
  var shakeEnabled = safeGet('night_shake', '1') !== '0';
  var lastTime = performance.now();
  var accumulator = 0;
  var STEP = 1 / 60;
  var visualTime = 0;
  var shake = 0;
  var dawnVisual = 0;
  var lastFocusState = false;
  var beamMoteTimer = 0;
  var currentToastTimer = null;
  var currentHintTimer = null;
  var tutorial = {};
  var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!isTouch && ('ontouchstart' in window) && navigator.maxTouchPoints > 0) isTouch = true;

  var lastHud = {
    hp: -1,
    oil: -1,
    time: '',
    caption: '',
    score: '',
    objective: '',
    lit: -1,
    phase: '',
    interactKey: '',
    dashDisabled: null,
    interactDisabled: null,
    mode: '',
    stage: -1,
    lampState: ''
  };

  if (isTouch) document.body.classList.add('is-touch');

  var keys = Object.create(null);
  var pointer = { x: W / 2, y: H / 2 - 80, inside: false, down: false, type: 'mouse' };
  var dashQueued = false;
  var touchInteract = false;
  var touchMove = { id: null, active: false, x: 0, y: 0 };
  var touchAim = { id: null, active: false, x: 0, y: 0, focus: false };
  var lastFocusedElement = null;
  var rotateHintDismissed = false;
  var selectedMode = safeGet('night_mode', 'short') === 'expedition' ? 'expedition' : 'short';
  var selectedMapId = CORE.MAPS[safeGet('night_map', 'village')] ? safeGet('night_map', 'village') : 'village';
  var selectedType = 'ember';
  (function initSelectedType() {
    var saved = safeGet('night_lighthouse', 'ember');
    if (CORE.LIGHTHOUSE_TYPES[saved] && CORE.LIGHTHOUSE_TYPES[saved].selectable) {
      selectedType = saved;
    }
  })();

  var heartsBuilt = false;
  function buildHearts() {
    if (heartsBuilt) return;
    UI.hearts.innerHTML = '';
    for (var i = 0; i < B.PLAYER_MAX_HP; i++) {
      var heart = document.createElement('span');
      heart.className = 'heart';
      heart.textContent = '♥';
      UI.hearts.appendChild(heart);
    }
    heartsBuilt = true;
  }

  function updateMuteUI() {
    UI.muteBtn.classList.toggle('is-muted', muted);
    UI.muteBtn.setAttribute('aria-label', muted ? '取消静音' : '静音');
    UI.muteBtn.setAttribute('title', muted ? '取消静音（M）' : '静音（M）');
    UI.titleMuteBtn.textContent = muted ? '声音：关' : '声音：开';
    if (AUDIO) AUDIO.setMuted(muted);
  }

  function updateShakeUI() {
    UI.shakeBtn.textContent = shakeEnabled ? '屏幕震动：开' : '屏幕震动：关';
    UI.shakeBtn.setAttribute('aria-label', shakeEnabled ? '关闭屏幕震动' : '开启屏幕震动');
  }

  function updateBestUI() {
    var shortRecord = loadRecord('short');
    var expeditionRecord = loadRecord('expedition');
    var parts = [];
    if (shortRecord.elapsed > 0) {
      parts.push('短夜 ' + formatDuration(shortRecord.elapsed));
    }
    if (expeditionRecord.elapsed > 0) {
      parts.push('远征 ' + formatDuration(expeditionRecord.elapsed));
    }
    if (parts.length === 0) {
      UI.bestRecord.textContent = '长夜尚未留下记录';
    } else {
      var bestScore = Math.max(shortRecord.score, expeditionRecord.score);
      UI.bestRecord.textContent = parts.join(' · ') + (bestScore > 0 ? ' · 最高分 ' + bestScore.toLocaleString('zh-CN') : '');
    }
  }

  function ensureAudio() {
    if (!AUDIO) return;
    AUDIO.init().then(function () {
      AUDIO.setMuted(muted);
    }).catch(function () {});
  }

  function toggleMute() {
    muted = !muted;
    safeSet('night_muted', muted ? '1' : '0');
    if (AUDIO) {
      if (!muted && !AUDIO.ctx) ensureAudio();
      AUDIO.setMuted(muted);
      if (!muted) AUDIO.ui();
    }
    updateMuteUI();
  }

  function toggleShake() {
    shakeEnabled = !shakeEnabled;
    safeSet('night_shake', shakeEnabled ? '1' : '0');
    updateShakeUI();
    if (AUDIO && !muted) AUDIO.ui();
  }

  function showToast(text, duration) {
    if (currentToastTimer) window.clearTimeout(currentToastTimer);
    UI.toast.textContent = text;
    UI.toast.setAttribute('aria-hidden', 'false');
    UI.toast.classList.add('is-visible');
    currentToastTimer = window.setTimeout(function () {
      UI.toast.classList.remove('is-visible');
      UI.toast.setAttribute('aria-hidden', 'true');
      UI.toast.textContent = '';
      currentToastTimer = null;
    }, duration || 2800);
  }

  function showHint(text, duration) {
    if (currentHintTimer) window.clearTimeout(currentHintTimer);
    UI.hintText.textContent = text;
    UI.hint.classList.add('is-visible');
    currentHintTimer = window.setTimeout(function () {
      UI.hint.classList.remove('is-visible');
      UI.hintText.textContent = '';
      currentHintTimer = null;
    }, duration || 7000);
  }

  /**
   * P0：收起、切换、重开、结算时清空瞬时提示的文本与定时器。
   * role=status 中只保留当前有效消息，隐藏容器不暴露上一局内容。
   */
  function clearTransientUI() {
    if (currentHintTimer) {
      window.clearTimeout(currentHintTimer);
      currentHintTimer = null;
    }
    if (currentToastTimer) {
      window.clearTimeout(currentToastTimer);
      currentToastTimer = null;
    }
    UI.hint.classList.remove('is-visible');
    UI.hintText.textContent = '';
    UI.toast.classList.remove('is-visible');
    UI.toast.setAttribute('aria-hidden', 'true');
    UI.toast.textContent = '';
  }

  var hideHints = clearTransientUI;

  function flashDamage() {
    UI.damageFlash.style.transition = 'none';
    UI.damageFlash.style.opacity = '0.92';
    window.requestAnimationFrame(function () {
      UI.damageFlash.style.transition = 'opacity 420ms ease-out';
      UI.damageFlash.style.opacity = '0';
    });
  }

  function addShake(amount) {
    if (!shakeEnabled) return;
    shake = Math.min(28, shake + amount);
  }

  function resetPageScroll() {
    var app = document.getElementById('app');
    if (app) {
      app.scrollTop = 0;
      app.scrollLeft = 0;
    }
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  }

  function syncScreens() {
    resetPageScroll();
    clearTransientUI();
    UI.screenTitle.hidden = appState !== 'title';
    UI.screenIntro.hidden = appState !== 'intro';
    UI.screenPause.hidden = appState !== 'paused';
    UI.screenDefeat.hidden = appState !== 'defeat';
    UI.screenVictory.hidden = appState !== 'victory';
    UI.screenHelp.hidden = !helpOpen;

    var hudVisible = appState === 'playing' || appState === 'paused' || appState === 'ending';
    UI.hud.classList.toggle('is-hidden', !hudVisible);
    UI.hud.setAttribute('aria-hidden', hudVisible ? 'false' : 'true');

    var touchVisible = appState === 'playing' && isTouch;
    UI.touchUI.classList.toggle('is-hidden', !touchVisible);
    UI.touchUI.setAttribute('aria-hidden', touchVisible ? 'false' : 'true');

    if (appState === 'title' || appState === 'intro') {
      UI.screenTitle.style.pointerEvents = appState === 'title' ? 'auto' : 'none';
      UI.screenIntro.style.pointerEvents = appState === 'intro' ? 'auto' : 'none';
    }

    if (document.activeElement && document.activeElement.blur && appState === 'playing') {
      document.activeElement.blur();
    }
  }

  function clearInputs() {
    keys = Object.create(null);
    pointer.down = false;
    dashQueued = false;
    touchInteract = false;
    touchMove.active = false;
    touchMove.id = null;
    touchMove.x = 0;
    touchMove.y = 0;
    touchAim.active = false;
    touchAim.id = null;
    touchAim.x = 0;
    touchAim.y = 0;
    touchAim.focus = false;
    UI.moveStick.classList.remove('is-active');
    UI.aimStick.classList.remove('is-active');
    resetKnob(UI.moveStick);
    resetKnob(UI.aimStick);
    UI.interactBtn.classList.remove('is-pressed');
    UI.dashBtn.classList.remove('is-pressed');
    lastFocusState = false;
    if (AUDIO) AUDIO.setFocus(false);
  }

  function resetGamePresentation() {
    particles.length = 0;
    shockwaves.length = 0;
    floaters.length = 0;
    shake = 0;
    dawnVisual = 0;
    endTimer = 0;
    endKind = null;
    resultRecorded = false;
    lastDefeatReason = 'health';
    accumulator = 0;
    lastFocusState = false;
    beamMoteTimer = 0;
    tutorial = {
      nearBrazier: false,
      firstLit: false,
      firstKill: false,
      secondLit: false,
      lowOil: false,
      allLit: false
    };
    lastHud.hp = -1;
    lastHud.oil = -1;
    lastHud.time = '';
    lastHud.caption = '';
    lastHud.score = '';
    lastHud.objective = '';
    lastHud.lit = -1;
    lastHud.phase = '';
    lastHud.interactKey = '';
    lastHud.mode = '';
    lastHud.stage = -1;
    lastHud.lampState = '';
    hideHints();
  }

  function getSelectedMap() {
    return CORE.MAPS[selectedMapId] || CORE.MAPS.village;
  }

  function getSelectedMode() {
    return CORE.MODES[selectedMode] || CORE.MODES.short;
  }

  function getSelectedType() {
    return CORE.LIGHTHOUSE_TYPES[selectedType] || CORE.LIGHTHOUSE_TYPES.ember;
  }

  function formatRunMeta(state) {
    if (!state) return '';
    var mode = CORE.getModeConfig(state);
    var map = CORE.getMapConfig(state);
    var type = CORE.getLighthouseConfig(state);
    var text = mode.name + ' · ' + map.name + ' · ' + type.name;
    if (state.expedition) {
      text += ' · 第 ' + state.expedition.stage + ' / 5 段';
    }
    return text;
  }

  function persistPrep() {
    safeSet('night_mode', selectedMode);
    safeSet('night_map', selectedMapId);
    safeSet('night_lighthouse', selectedType);
  }

  function updatePrepUI() {
    var mode = getSelectedMode();
    var map = getSelectedMap();
    var type = getSelectedType();
    UI.prepModeShort.classList.toggle('is-selected', selectedMode === 'short');
    UI.prepModeExpedition.classList.toggle('is-selected', selectedMode === 'expedition');
    UI.prepModeShort.setAttribute('aria-pressed', selectedMode === 'short' ? 'true' : 'false');
    UI.prepModeExpedition.setAttribute('aria-pressed', selectedMode === 'expedition' ? 'true' : 'false');
    UI.prepModeNote.textContent = selectedMode === 'short'
      ? '四灯 → 返塔 → 二十秒守夜'
      : '四灯 → 运油 → 追灯 → 清雾 → 唤醒';

    Array.prototype.forEach.call(UI.mapChoices.querySelectorAll('[data-map]'), function (button) {
      var active = button.getAttribute('data-map') === selectedMapId;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    Array.prototype.forEach.call(UI.lighthouseChoices.querySelectorAll('[data-type]'), function (button) {
      var active = button.getAttribute('data-type') === selectedType;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    UI.prepSummary.textContent = mode.name + ' · ' + map.name + ' · ' + type.name +
      (selectedMode === 'expedition' ? ' · 目标 3–5 分钟' : ' · 目标约 45 秒');
    persistPrep();
  }

  function openPrep(mode) {
    if (appState !== 'title') return;
    ensureAudio();
    if (AUDIO && !muted) AUDIO.ui();
    selectedMode = mode === 'expedition' ? 'expedition' : 'short';
    if (selectedMode === 'expedition' && selectedMapId === 'village' &&
      safeGet('night_seen_expedition', '0') !== '1') {
      selectedMapId = 'forest';
    }
    if (selectedMode === 'expedition') safeSet('night_seen_expedition', '1');
    appState = 'intro';
    updatePrepUI();
    hideHints();
    syncScreens();
    var content = UI.screenIntro.querySelector('.intro-content');
    if (content) content.scrollTop = 0;
    void UI.screenIntro.offsetWidth;
  }

  function goIntro() {
    openPrep('short');
  }

  function beginGame() {
    ensureAudio();
    if (AUDIO) {
      AUDIO.setMuted(muted);
      AUDIO.setTension(false);
      AUDIO.setFocus(false);
    }
    persistPrep();
    gameState = CORE.createGame({
      seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
      mode: selectedMode,
      mapId: selectedMapId,
      lighthouseType: selectedType
    });
    appState = 'playing';
    helpOpen = false;
    resetGamePresentation();
    prepareMapVisuals(gameState.mapId);
    syncScreens();
    lastTime = performance.now();
    visualTime = 0;
    updateHud(true);
    if (isTouch) {
      showHint('左摇杆移动 · 右摇杆瞄准并亮灯 · 靠近古灯后按住「点灯」', 7200);
      maybeShowRotateHint();
    } else {
      showHint('WASD 移动 · 鼠标瞄准 · 按住左键亮灯 · Shift 疾步', 7200);
    }
    if (gameState.mode === 'expedition') {
      window.setTimeout(function () {
        if (appState === 'playing' && gameState && gameState.expedition && gameState.expedition.stage === 1) {
          showToast('远征开始 · 四灯之后，路还很长', 3600);
        }
      }, 700);
    }
  }

  function goTitle() {
    appState = 'title';
    gameState = null;
    helpOpen = false;
    clearInputs();
    hideHints();
    updateBestUI();
    updateMuteUI();
    updateShakeUI();
    syncScreens();
    if (AUDIO) {
      AUDIO.setFocus(false);
      AUDIO.setTension(false);
      AUDIO.resume();
    }
    rotateHintDismissed = false;
    UI.rotateHint.hidden = true;
  }

  function pauseGame(auto) {
    if (appState !== 'playing') return;
    appState = 'paused';
    clearInputs();
    if (AUDIO) AUDIO.suspend();
    updatePauseStats();
    syncScreens();
    lastFocusedElement = UI.pauseBtn;
    window.setTimeout(function () {
      if (appState === 'paused') $('resumeBtn').focus();
    }, 60);
    if (!auto) {
      /* 无额外提示 */
    }
  }

  function resumeGame() {
    if (appState !== 'paused' || helpOpen) return;
    if (AUDIO) AUDIO.resume();
    appState = 'playing';
    helpOpen = false;
    lastTime = performance.now();
    accumulator = 0;
    syncScreens();
  }

  function updatePauseStats() {
    if (!gameState) return;
    UI.pauseLit.textContent = String(CORE.getLitCount(gameState));
    UI.pauseTime.textContent = formatClock(gameState.timeLeft);
    UI.pauseMode.textContent = formatRunMeta(gameState);
  }

  function openHelp() {
    if (helpOpen) return;
    helpOpen = true;
    lastFocusedElement = document.activeElement;
    syncScreens();
    window.setTimeout(function () {
      if (helpOpen) $('helpCloseBtn').focus();
    }, 60);
  }

  function closeHelp() {
    if (!helpOpen) return;
    helpOpen = false;
    syncScreens();
    if (lastFocusedElement && lastFocusedElement.focus) {
      try { lastFocusedElement.focus(); } catch (error) { /* ignore */ }
    }
  }

  function showEndScreen(kind) {
    appState = kind;
    helpOpen = false;
    clearInputs();
    syncScreens();
    if (kind === 'victory') {
      populateVictory();
      if (AUDIO) AUDIO.victory();
    } else {
      populateDefeat();
      if (AUDIO) AUDIO.defeat();
    }
    window.setTimeout(function () {
      if (appState === 'victory') $('againBtn').focus();
      else if (appState === 'defeat') $('retryBtn').focus();
    }, 80);
  }

  function finishEnding() {
    if (!gameState) {
      goTitle();
      return;
    }
    if (gameState.phase === 'victory') {
      showEndScreen('victory');
    } else {
      showEndScreen('defeat');
    }
  }

  function beginEnding(kind) {
    if (appState !== 'playing') return;
    appState = 'ending';
    endKind = kind;
    endTimer = 1.15;
    clearInputs();
    syncScreens();
    if (AUDIO) {
      AUDIO.setFocus(false);
      AUDIO.setTension(false);
      if (kind === 'victory') {
        addShake(10);
        dawnVisual = Math.max(dawnVisual, 0.15);
      } else {
        addShake(8);
      }
    }
  }

  function populateDefeat() {
    if (!gameState) return;
    var reason = lastDefeatReason;
    var isDawn = reason === 'dawn';
    $('defeatTitle').textContent = isDawn ? '天亮了。' : '灯灭了。';
    UI.defeatCause.textContent = isDawn
      ? '天亮了，可长灯没有醒来。村庄仍在夜里。'
      : '黑暗漫过脚边。灯灭了，但夜还没有结束。';
    $('defeatHint').textContent = isDawn
      ? '提示：时间比灯火先耗尽。先点亮近处的古灯，再赶回灯塔。'
      : '提示：站在已点亮的古灯旁，灯油会慢慢恢复；每点亮一盏古灯，还会恢复一颗心。';
    UI.defeatLit.textContent = CORE.getLitCount(gameState) + ' / 4';
    UI.defeatKills.textContent = String(gameState.kills);
    UI.defeatTime.textContent = formatDuration(Math.round(gameState.elapsed));
    UI.defeatScore.textContent = gameState.score.toLocaleString('zh-CN');
    UI.defeatMode.textContent = formatRunMeta(gameState);
  }

  function populateVictory() {
    if (!gameState) return;
    var record = loadRecord(gameState.mode);
    var runSeconds = Math.max(1, Math.round(gameState.elapsed));
    var newBestScore = gameState.score > record.score;
    var newBestTime = record.elapsed === 0 || runSeconds < record.elapsed;
    var updated = {
      score: Math.max(record.score, gameState.score),
      elapsed: record.elapsed === 0 ? runSeconds : Math.min(record.elapsed, runSeconds)
    };
    if (!resultRecorded) {
      saveRecord(updated, gameState.mode);
      resultRecorded = true;
    }

    var hp = gameState.player.hp;
    if (hp >= 4) {
      UI.victoryText.textContent = '四盏灯都亮着。你守住了这一夜，也守住了自己。';
    } else if (hp <= 1) {
      UI.victoryText.textContent = '最后一点灯油燃尽时，第一缕晨光刚好落在灯罩上。';
    } else {
      UI.victoryText.textContent = '第一缕晨光落在灯罩上。你守住了这一夜。';
    }

    UI.victoryTime.textContent = formatDuration(runSeconds);
    UI.victoryKills.textContent = String(gameState.kills);
    UI.victoryOil.textContent = String(gameState.oilCollected);
    UI.victoryScore.textContent = gameState.score.toLocaleString('zh-CN');
    UI.victoryMode.textContent = formatRunMeta(gameState);
    UI.newRecord.hidden = !(newBestScore || newBestTime);
    UI.victoryRecordLine.textContent = updated.elapsed > 0
      ? '最佳守夜 · ' + formatDuration(updated.elapsed) + ' · 最高分 ' + updated.score.toLocaleString('zh-CN')
      : '最佳守夜 · 尚无记录';
    updateBestUI();
  }

  /* ============================================================
     输入
     ============================================================ */

  function motionKeysActive() {
    return keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD ||
      keys.ArrowUp || keys.ArrowLeft || keys.ArrowDown || keys.ArrowRight;
  }

  function updatePointerFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointer.x = clamp((event.clientX - rect.left) / rect.width, 0, 1) * W;
    pointer.y = clamp((event.clientY - rect.top) / rect.height, 0, 1) * H;
    pointer.inside = true;
  }

  function getAimVector() {
    if (!gameState) return { x: 0, y: -1 };
    if (touchAim.active && Math.hypot(touchAim.x, touchAim.y) > 0.16) {
      var len = Math.hypot(touchAim.x, touchAim.y);
      return { x: touchAim.x / len, y: touchAim.y / len };
    }
    if (pointer.inside) {
      var dx = pointer.x - gameState.player.x;
      var dy = pointer.y - gameState.player.y;
      var distance = Math.hypot(dx, dy);
      if (distance > 16) return { x: dx / distance, y: dy / distance };
    }
    return { x: gameState.player.aimX, y: gameState.player.aimY };
  }

  function buildInput(consumeDash) {
    var moveX = 0;
    var moveY = 0;
    if (keys.KeyW || keys.ArrowUp) moveY -= 1;
    if (keys.KeyS || keys.ArrowDown) moveY += 1;
    if (keys.KeyA || keys.ArrowLeft) moveX -= 1;
    if (keys.KeyD || keys.ArrowRight) moveX += 1;
    if (touchMove.active) {
      moveX += touchMove.x;
      moveY += touchMove.y;
    }
    var length = Math.hypot(moveX, moveY);
    if (length > 1) {
      moveX /= length;
      moveY /= length;
    }
    var aim = getAimVector();
    var focus = pointer.down || keys.Space || (touchAim.active && touchAim.focus);
    var interact = !!keys.KeyE || touchInteract;
    var dash = dashQueued;
    if (dash && consumeDash) dashQueued = false;
    return {
      moveX: moveX,
      moveY: moveY,
      aimX: aim.x,
      aimY: aim.y,
      focus: focus,
      interact: interact,
      dash: dash
    };
  }

  function setupStick(element, target, isMove) {
    var base = element.querySelector('.stick-base');
    var knob = element.querySelector('.stick-knob');
    var centerX = 0;
    var centerY = 0;
    var pointerId = null;

    function updateFromPointer(event) {
      var dx = event.clientX - centerX;
      var dy = event.clientY - centerY;
      var rect = base.getBoundingClientRect();
      var radius = rect.width * 0.36;
      var distance = Math.hypot(dx, dy);
      if (distance > radius) {
        dx = (dx / distance) * radius;
        dy = (dy / distance) * radius;
      }
      knob.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px))';
      target.active = true;
      if (isMove) {
        target.x = dx / radius;
        target.y = dy / radius;
      } else {
        var nx = dx / radius;
        var ny = dy / radius;
        target.x = nx;
        target.y = ny;
        target.focus = true;
      }
    }

    element.addEventListener('pointerdown', function (event) {
      if (pointerId !== null) return;
      event.preventDefault();
      ensureAudio();
      pointerId = event.pointerId;
      try { element.setPointerCapture(event.pointerId); } catch (error) { /* 合成事件或旧浏览器 */ }
      var rect = base.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      target.id = event.pointerId;
      target.active = true;
      if (!isMove) target.focus = true;
      element.classList.add('is-active');
      updateFromPointer(event);
    }, { passive: false });

    element.addEventListener('pointermove', function (event) {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      updateFromPointer(event);
    }, { passive: false });

    function release(event) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      target.id = null;
      target.active = false;
      target.x = 0;
      target.y = 0;
      if (!isMove) target.focus = false;
      element.classList.remove('is-active');
      knob.style.transform = 'translate(-50%, -50%)';
    }

    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', function (event) {
      if (event.pointerId === pointerId) release(event);
    });
  }

  function resetKnob(element) {
    var knob = element.querySelector('.stick-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  function setupTouchControls() {
    setupStick(UI.moveStick, touchMove, true);
    setupStick(UI.aimStick, touchAim, false);

    UI.dashBtn.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      ensureAudio();
      dashQueued = true;
      UI.dashBtn.classList.add('is-pressed');
    }, { passive: false });
    UI.dashBtn.addEventListener('pointerup', function () {
      UI.dashBtn.classList.remove('is-pressed');
    });
    UI.dashBtn.addEventListener('pointercancel', function () {
      UI.dashBtn.classList.remove('is-pressed');
    });
    UI.dashBtn.addEventListener('pointerleave', function () {
      UI.dashBtn.classList.remove('is-pressed');
    });

    UI.interactBtn.addEventListener('pointerdown', function (event) {
      if (UI.interactBtn.disabled) return;
      event.preventDefault();
      ensureAudio();
      touchInteract = true;
      UI.interactBtn.classList.add('is-pressed');
      try { UI.interactBtn.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    }, { passive: false });
    function releaseInteract() {
      touchInteract = false;
      UI.interactBtn.classList.remove('is-pressed');
    }
    UI.interactBtn.addEventListener('pointerup', releaseInteract);
    UI.interactBtn.addEventListener('pointercancel', releaseInteract);
    UI.interactBtn.addEventListener('lostpointercapture', releaseInteract);
  }

  function maybeShowRotateHint() {
    if (!isTouch || rotateHintDismissed) return;
    if (window.innerHeight <= window.innerWidth) return;
    UI.rotateHint.hidden = false;
    window.setTimeout(function () {
      if (!rotateHintDismissed) UI.rotateHint.hidden = true;
    }, 6500);
  }

  /* ============================================================
     核心事件 -> 表现
     ============================================================ */

  function handleCoreEvent(event) {
    switch (event.type) {
      case 'brazier-lit':
        addShake(6);
        addShockwave(event.x, event.y, 170, 1.1);
        burst(event.x, event.y, 28, 'ember', 26, 78);
        burst(event.x, event.y, 10, 'spark', 14, 110);
        addFloater(event.x, event.y - 30, '+100', '#ffd696');
        if (AUDIO) AUDIO.ignite();
        showToast('「' + event.name + '」已点亮');
        if (event.litCount === 1 && !tutorial.firstLit) {
          tutorial.firstLit = true;
          showHint('古灯会恢复生命与灯油。四盏都亮起后，回到中央灯塔。', 7600);
        }
        if (event.litCount === 2 && !tutorial.secondLit) {
          tutorial.secondLit = true;
          showHint(isTouch ? '被围住时按「疾步」，短暂无敌。' : '被围住时按 Shift 疾步，短暂无敌。', 6200);
        }
        break;
      case 'all-lit':
        if (!tutorial.allLit) {
          tutorial.allLit = true;
          if (AUDIO) AUDIO.ui();
          if (gameState && gameState.mode === 'short') {
            showToast('四灯皆亮 · 回到中央灯塔', 4200);
            showHint(isTouch ? '回到中央灯塔，按住「点灯」唤醒长灯。' : '回到中央灯塔，按住 E 唤醒长灯。', 7600);
          }
        }
        break;
      case 'lighthouse-start':
        addShake(18);
        addShockwave(event.x, event.y, 520, 1.8);
        burst(event.x, event.y, 48, 'ember', 40, 120);
        burst(event.x, event.y, 24, 'spark', 18, 150);
        if (AUDIO) {
          AUDIO.finale();
          AUDIO.setTension(true);
        }
        var finaleSeconds = gameState && gameState.mode === 'expedition' ? '三十秒' : '二十秒';
        showToast('长灯苏醒 · 守住最后' + finaleSeconds, 4200);
        showHint('留在长灯的光里，撑过这' + finaleSeconds + '。', 5000);
        break;
      case 'enemy-killed':
        var brute = event.enemyType === 'brute';
        var special = event.enemyType === 'thief' || event.enemyType === 'weaver';
        burst(event.x, event.y, brute ? 18 : special ? 14 : 8, 'ember', brute ? 20 : special ? 16 : 10, brute ? 80 : 56);
        burst(event.x, event.y, brute ? 12 : 5, 'smoke', 14, 24);
        if (brute || special) {
          addShake(brute ? 7 : 4);
          addFloater(event.x, event.y - 20, '+' + event.score, special ? '#9fe0d4' : '#e6c59a');
        }
        if (!tutorial.firstKill) {
          tutorial.firstKill = true;
        }
        if (AUDIO) AUDIO.kill(event.enemyType);
        break;
      case 'enemy-hit':
        if (particles.length < 280) {
          addParticle('spark', event.x + (Math.random() - 0.5) * 12, event.y + (Math.random() - 0.5) * 12, {
            vx: (Math.random() - 0.5) * 90,
            vy: (Math.random() - 0.5) * 90,
            life: 0.22 + Math.random() * 0.25,
            size: 1.2,
            color: '#ffdaa0'
          });
        }
        break;
      case 'player-hit':
        flashDamage();
        addShake(14);
        burst(event.x, event.y, 10, 'spark', 12, 125);
        if (AUDIO) AUDIO.hit();
        break;
      case 'pickup-oil':
        addShockwave(event.x, event.y, 42, 0.5);
        burst(event.x, event.y, 7, 'ember', 6, 28);
        addFloater(event.x, event.y - 16, '+' + event.amount + ' 灯油', '#ffd28d');
        if (AUDIO) AUDIO.pickup();
        break;
      case 'dash':
        addShake(2);
        for (var d = 0; d < 7; d++) {
          addParticle('smoke', event.x + (Math.random() - 0.5) * 20, event.y + (Math.random() - 0.5) * 20, {
            vx: (Math.random() - 0.5) * 30,
            vy: (Math.random() - 0.5) * 30,
            life: 0.4 + Math.random() * 0.3,
            size: 5 + Math.random() * 4,
            color: '#294b4e'
          });
        }
        if (AUDIO) AUDIO.dash();
        break;
      case 'oil-empty':
        if (!tutorial.lowOil) {
          tutorial.lowOil = true;
          showHint(isTouch ? '灯油不足。拾取暗影掉落的橙色余烬。' : '灯油不足。拾取暗影掉落的橙色余烬补充。', 6200);
        }
        if (event.reason === 'ignite') showToast('灯油不足以点燃古灯', 2200);
        else showToast('灯油不足', 1800);
        if (AUDIO) AUDIO.oilEmpty();
        break;
      case 'stage-pulse':
        addShake(7);
        addShockwave(event.x, event.y, 330, 1.2);
        burst(event.x, event.y, 24, 'ember', 40, 90);
        break;
      case 'expedition-stage':
        addShake(9);
        addShockwave(gameState.lighthouse.x, gameState.lighthouse.y, 260, 1.2);
        burst(gameState.lighthouse.x, gameState.lighthouse.y, 20, 'ember', 20, 70);
        if (AUDIO) {
          AUDIO.ignite();
          AUDIO.setTension(true);
        }
        showToast('第 ' + event.stage + ' 段 · ' + event.title, 4200);
        showHint(event.detail, 7000);
        break;
      case 'cargo-spawned':
        addShockwave(event.x, event.y, 80, 0.9, 'rgba(159, 224, 212, ');
        break;
      case 'cargo-picked':
        if (AUDIO) AUDIO.pickup();
        showToast('灯油已背起 · 送回长灯', 2400);
        showHint(isTouch ? '携带灯油时移动更慢，受伤会掉落。' : '携带灯油时移动更慢，受伤会掉落。', 5200);
        break;
      case 'cargo-dropped':
        addShake(5);
        if (AUDIO) AUDIO.hit();
        showToast('灯油洒落 · 回去捡起', 2400);
        break;
      case 'cargo-delivered':
        addShake(4);
        addShockwave(event.x, event.y, 150, 1.0);
        burst(event.x, event.y, 14, 'ember', 16, 60);
        if (AUDIO) AUDIO.pickup();
        showToast('长灯油归位 · ' + event.delivered + ' / ' + event.required, 2400);
        break;
      case 'thief-channel':
        showHint('携灯影正在窃取「' + event.name + '」 · 打退它！', 4800);
        showToast('灯火被窃 · 击退携灯影', 2400);
        addShake(3);
        if (AUDIO) AUDIO.oilEmpty();
        break;
      case 'brazier-stolen':
        addShake(10);
        addShockwave(event.x, event.y, 130, 0.9, 'rgba(174, 111, 192, ');
        if (AUDIO) AUDIO.hit();
        showToast('「' + event.name + '」被窃 · 击杀携灯影夺回', 3400);
        break;
      case 'brazier-restored':
        addShockwave(event.x, event.y, 160, 0.9);
        burst(event.x, event.y, 12, 'ember', 12, 50);
        if (AUDIO) AUDIO.ignite();
        showToast('「' + event.name + '」灯芯归还', 2600);
        break;
      case 'wick-recovered':
        addFloater(event.x, event.y - 18, '灯芯 +10 油', '#9fe0d4');
        break;
      case 'thief-slain':
        showToast('携灯影退散 · ' + event.killed + ' / ' + event.required, 2600);
        break;
      case 'weaver-slain':
        showToast('缠雾者消散 · ' + event.killed + ' / ' + event.required, 2600);
        break;
      case 'fog-telegraph':
        if (gameState && gameState.expedition && !gameState.expedition.fogHintShown) {
          gameState.expedition.fogHintShown = true;
          showHint('缠雾者正在聚集雾带 · 离开预警圈', 5000);
        }
        break;
      case 'fog-created':
        showToast('雾带封路 · 用灯火驱散或绕开', 2600);
        break;
      case 'fog-cleared':
        addShockwave(event.x, event.y, 90, 0.7, 'rgba(159, 224, 212, ');
        burst(event.x, event.y, 8, 'spark', 18, 70);
        if (AUDIO) AUDIO.pickup();
        addFloater(event.x, event.y - 14, '雾散 +12', '#9fe0d4');
        break;
      case 'fog-dissolved':
        addShockwave(event.x, event.y, 150, 0.9, 'rgba(159, 224, 212, ');
        showToast('缠雾者消散 · 雾气退去', 2200);
        break;
      case 'finale-tick':
        addShake(1.4);
        if (AUDIO) AUDIO.heartbeat();
        break;
      case 'defeat':
        lastDefeatReason = event.reason || 'health';
        break;
      default:
        break;
    }
  }

  function drainCoreEvents() {
    if (!gameState) return;
    var events = CORE.drainEvents(gameState);
    for (var i = 0; i < events.length; i++) {
      handleCoreEvent(events[i]);
    }
  }

  /* ============================================================
     HUD
     ============================================================ */

  function updateHud(force) {
    if (!gameState) return;
    var player = gameState.player;
    var phase = gameState.phase;
    var lit = CORE.getLitCount(gameState);
    var mode = CORE.getModeConfig(gameState);
    var map = CORE.getMapConfig(gameState);
    var lighthouseType = CORE.getLighthouseConfig(gameState);

    if (force || lastHud.mode !== gameState.mode) {
      lastHud.mode = gameState.mode;
      UI.modeChip.textContent = gameState.mode === 'expedition' ? '远征' : '短夜';
      UI.modeChip.setAttribute('title', mode.name + ' · ' + map.name + ' · ' + lighthouseType.name);
    }
    if (gameState.expedition) {
      if (force || lastHud.stage !== gameState.expedition.stage) {
        lastHud.stage = gameState.expedition.stage;
        UI.stageDots.hidden = false;
        UI.stageDots.setAttribute('aria-label', '远征阶段 ' + gameState.expedition.stage + ' / 5');
        for (var stageIndex = 0; stageIndex < UI.stageDotNodes.length; stageIndex++) {
          UI.stageDotNodes[stageIndex].classList.toggle('is-done', stageIndex < gameState.expedition.stage - 1);
          UI.stageDotNodes[stageIndex].classList.toggle('is-current', stageIndex === gameState.expedition.stage - 1);
        }
      }
    } else if (!UI.stageDots.hidden) {
      UI.stageDots.hidden = true;
    }

    if (force || lastHud.hp !== player.hp) {
      lastHud.hp = player.hp;
      var heartNodes = UI.hearts.children;
      for (var i = 0; i < heartNodes.length; i++) {
        heartNodes[i].classList.toggle('is-full', i < player.hp);
      }
      UI.hearts.setAttribute('aria-label', '生命值 ' + player.hp + ' / ' + player.maxHp);
    }

    var oilPercent = Math.round((player.oil / player.maxOil) * 100);
    if (force || lastHud.oil !== oilPercent) {
      lastHud.oil = oilPercent;
      UI.oilFill.style.width = clamp(oilPercent, 0, 100) + '%';
      UI.oilFill.classList.toggle('is-low', player.oil < 22);
      UI.oilValue.textContent = String(Math.round(player.oil));
    }

    var timeText;
    var caption;
    if (phase === 'finale') {
      var finaleDuration = gameState.finaleDuration || B.FINALE_DURATION;
      var remaining = Math.max(0, finaleDuration - gameState.finaleTime);
      timeText = formatClock(remaining);
      caption = gameState.mode === 'expedition' ? '远征 · 长灯苏醒' : '长灯苏醒';
      UI.finaleMeter.hidden = false;
      UI.finaleFill.style.width = clamp((gameState.finaleTime / finaleDuration) * 100, 0, 100) + '%';
    } else {
      timeText = formatClock(gameState.timeLeft);
      caption = gameState.mode === 'expedition' ? '远征 · 天亮之前' : '天亮之前';
      UI.finaleMeter.hidden = true;
      if (phase === 'victory') {
        timeText = '00:00';
        caption = '黎明已至';
      }
    }
    if (force || lastHud.time !== timeText || lastHud.caption !== caption) {
      lastHud.time = timeText;
      lastHud.caption = caption;
      UI.timeValue.textContent = timeText;
      UI.timeCaption.textContent = caption;
    }
    var urgent = (phase !== 'finale' && gameState.timeLeft <= 45) || (phase === 'finale' && remaining <= 5);
    UI.timeValue.classList.toggle('is-urgent', urgent);

    var lampState = gameState.braziers.map(function (b) {
      return (b.lit ? '1' : '0') + (b.suppressed > 0 ? 's' : '');
    }).join('|');
    if (force || lastHud.lampState !== lampState) {
      lastHud.lampState = lampState;
      var stolenCount = 0;
      for (var d = 0; d < UI.lampDots.length; d++) {
        var brazier = gameState.braziers[d];
        if (!brazier) continue;
        UI.lampDots[d].classList.toggle('is-lit', brazier.lit);
        UI.lampDots[d].classList.toggle('is-stolen', brazier.suppressed > 0);
        if (brazier.suppressed > 0) stolenCount++;
      }
      UI.lampStatus.setAttribute('aria-label', '古灯 ' + lit + ' / 4' +
        (stolenCount ? '，' + stolenCount + ' 盏被携灯影窃取' : ''));
      lastHud.lit = lit;
    }

    var scoreText = gameState.score.toLocaleString('zh-CN');
    if (force || lastHud.score !== scoreText) {
      lastHud.score = scoreText;
      UI.scoreValue.textContent = scoreText;
    }

    var objective = CORE.getObjective(gameState);
    if (force || lastHud.objective !== objective) {
      lastHud.objective = objective;
      UI.objectiveText.textContent = objective;
      UI.objective.classList.toggle('is-urgent', lit === 4 || phase === 'finale' ||
        (gameState.expedition && gameState.expedition.stage >= 2));
    }

    var target = phase === 'playing' ? CORE.getInteractTarget(gameState) : null;
    var targetVisible = !!target && appState === 'playing';
    UI.interactPrompt.classList.toggle('is-visible', targetVisible);
    UI.interactPrompt.setAttribute('aria-hidden', targetVisible ? 'false' : 'true');

    var interactKey = '';
    var progress = 0;
    var canInteract = false;
    var label = '点灯';
    if (target) {
      progress = target.progress;
      canInteract = target.canInteract;
      if (target.type === 'brazier') {
        interactKey = 'brazier-' + canInteract + '-' + isTouch;
        label = canInteract ? '点灯' : '缺灯油';
      } else {
        interactKey = 'lighthouse-' + isTouch;
        label = '唤醒';
        canInteract = true;
      }
      if (!tutorial.nearBrazier && target.type === 'brazier') {
        tutorial.nearBrazier = true;
        showHint(isTouch ? '按住「点灯」直到光环亮起。点燃会消耗 15 灯油。' : '按住 E 直到光环亮起。点燃会消耗 15 灯油。', 6000);
      }
    }

    if (force || lastHud.interactKey !== interactKey) {
      lastHud.interactKey = interactKey;
      if (target) {
        if (target.type === 'brazier') {
          if (isTouch) {
            UI.interactText.textContent = canInteract ? '按住「点灯」点亮古灯' : '灯油不足 · 需要 15';
          } else {
            UI.interactText.innerHTML = canInteract ? '按住 <kbd>E</kbd> 点亮古灯' : '灯油不足 · 需要 15';
          }
        } else if (isTouch) {
          UI.interactText.textContent = '按住「点灯」唤醒长灯';
        } else {
          UI.interactText.innerHTML = '按住 <kbd>E</kbd> 唤醒长灯';
        }
      }
    }
    UI.interactFill.style.width = clamp(progress * 100, 0, 100) + '%';
    UI.interactFill.style.background = canInteract
      ? 'linear-gradient(90deg, #f5b45d, #fff0c4)'
      : 'linear-gradient(90deg, #974438, #d57a62)';

    var dashDisabled = player.dashCooldown > 0.02;
    if (force || lastHud.dashDisabled !== dashDisabled) {
      lastHud.dashDisabled = dashDisabled;
      UI.dashBtn.disabled = dashDisabled;
    }
    var dashLabel = UI.dashBtn.querySelector('.touch-label');
    if (dashLabel) dashLabel.textContent = dashDisabled ? player.dashCooldown.toFixed(1) : '疾步';

    var interactDisabled = !targetVisible || !canInteract;
    if (force || lastHud.interactDisabled !== interactDisabled) {
      lastHud.interactDisabled = interactDisabled;
      UI.interactBtn.disabled = interactDisabled;
    }
    if (UI.interactBtnLabel.textContent !== label) UI.interactBtnLabel.textContent = label;
  }

  /* ============================================================
     绘制：世界
     ============================================================ */

  function drawGlow(g, sprite, x, y, radius, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    g.globalAlpha = alpha;
    g.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    g.globalAlpha = 1;
  }

  function drawFog(g, time) {
    g.save();
    g.globalCompositeOperation = 'screen';
    var fogs = [
      { x: 230 + Math.sin(time * 0.035) * 120, y: 240 + Math.cos(time * 0.027) * 60, r: 340, a: 0.32 },
      { x: 980 + Math.cos(time * 0.03 + 1) * 150, y: 420 + Math.sin(time * 0.026) * 80, r: 390, a: 0.28 },
      { x: 520 + Math.sin(time * 0.02 + 2) * 180, y: 620 + Math.cos(time * 0.031) * 40, r: 300, a: 0.22 },
      { x: 760 + Math.cos(time * 0.024 + 2) * 120, y: 120 + Math.sin(time * 0.03) * 50, r: 260, a: 0.18 }
    ];
    for (var i = 0; i < fogs.length; i++) {
      var fog = fogs[i];
      g.globalAlpha = fog.a;
      g.drawImage(fogSprite, fog.x - fog.r, fog.y - fog.r, fog.r * 2, fog.r * 2);
    }
    g.restore();
  }

  function brazierDisplayList() {
    return gameState ? gameState.braziers : getSelectedMap().braziers.map(function (def, index) {
      return { id: def.id, name: def.name, x: def.x, y: def.y, lit: false, index: index, progress: 0, pulse: 0, flare: 0 };
    });
  }

  function drawBrazierBase(g, brazier, time) {
    var x = brazier.x;
    var y = brazier.y;
    var stolen = brazier.suppressed > 0;
    var active = brazier.lit && !stolen;
    g.save();
    g.translate(x, y);

    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(0, 12, 31, 13, 0, 0, TAU);
    g.fill();

    g.beginPath();
    g.arc(0, 0, 24, 0, TAU);
    g.fillStyle = stolen
      ? 'rgba(47, 35, 53, 0.98)'
      : active ? 'rgba(65, 56, 34, 0.98)' : 'rgba(36, 53, 49, 0.98)';
    g.fill();
    g.strokeStyle = stolen
      ? 'rgba(188, 130, 206, 0.52)'
      : active ? 'rgba(255, 200, 116, 0.55)' : 'rgba(167, 188, 169, 0.3)';
    g.lineWidth = 1.2;
    g.stroke();

    g.beginPath();
    g.arc(0, 0, 29, 0, TAU);
    g.strokeStyle = stolen
      ? 'rgba(195, 140, 211, 0.2)'
      : active ? 'rgba(255, 213, 143, 0.16)' : 'rgba(159, 190, 180, 0.12)';
    g.lineWidth = 0.8;
    g.setLineDash([2, 6]);
    g.stroke();
    g.setLineDash([]);

    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU + 0.3;
      g.beginPath();
      g.arc(Math.cos(a) * 17, Math.sin(a) * 17, 6, 0, TAU);
      g.fillStyle = stolen
        ? 'rgba(58, 47, 63, 0.96)'
        : active ? 'rgba(83, 66, 41, 0.96)' : 'rgba(45, 60, 54, 0.96)';
      g.fill();
      g.strokeStyle = 'rgba(173, 186, 156, 0.16)';
      g.stroke();
    }

    g.beginPath();
    g.arc(0, 0, 12, 0, TAU);
    g.fillStyle = stolen
      ? 'rgba(121, 81, 151, 0.2)'
      : active ? 'rgba(255, 157, 64, 0.24)' : 'rgba(5, 13, 16, 0.9)';
    g.fill();

    if (!brazier.lit) {
      g.beginPath();
      g.arc(0, 0, 17, 0, TAU);
      g.strokeStyle = 'rgba(119, 157, 158, 0.12)';
      g.lineWidth = 0.8;
      g.stroke();
    }

    if (!brazier.lit) {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowBlue, 0, -2, 48, 0.3);
      g.fillStyle = 'rgba(181, 225, 210, 0.7)';
      g.beginPath();
      g.moveTo(0, -6 + Math.sin(time * 2.2 + brazier.index) * 1.2);
      g.quadraticCurveTo(4, -1, 0, 4);
      g.quadraticCurveTo(-4, -1, 0, -6 + Math.sin(time * 2.2 + brazier.index) * 1.2);
      g.fill();
      g.restore();
    }

    var labelAlpha = stolen ? 0.72 : active ? 0.78 : 0.48;
    g.globalAlpha = labelAlpha;
    g.fillStyle = stolen ? '#cda2d8' : active ? '#f2d8a5' : '#a9c3ba';
    g.font = '10px "Songti SC", "STSong", serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(stolen ? brazier.name + ' · 被窃' : brazier.name, 0, 36);
    g.globalAlpha = 1;

    g.restore();
  }

  function drawBrazierFlame(g, brazier, time) {
    if (!brazier.lit) return;
    var x = brazier.x;
    var y = brazier.y;
    var flicker = Math.sin(time * 9 + brazier.index * 2.1) * 1.4 + Math.sin(time * 15.3 + brazier.index) * 0.7;
    var pulse = brazier.pulse || 0;

    if (brazier.suppressed > 0) {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowPurple, x, y, 58 + Math.sin(time * 4) * 5, 0.2);
      g.translate(x, y - 5);
      g.beginPath();
      g.moveTo(0, 3);
      g.bezierCurveTo(-7, -7, -2, -18, 1, -24);
      g.bezierCurveTo(7, -12, 8, -4, 0, 3);
      g.fillStyle = 'rgba(154, 98, 174, 0.55)';
      g.fill();
      g.strokeStyle = 'rgba(210, 157, 222, 0.3)';
      g.lineWidth = 0.8;
      g.setLineDash([2, 4]);
      g.beginPath();
      g.arc(0, 0, 17, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      return;
    }

    g.save();
    g.globalCompositeOperation = 'screen';
    drawGlow(g, glowWarm, x, y - 2, 76 + pulse * 60, 0.44 + pulse * 0.25);

    g.translate(x, y - 4);
    g.beginPath();
    g.moveTo(0, 4);
    g.bezierCurveTo(-8 - flicker, -8, -3, -24 - flicker * 1.2, 0, -30 - flicker);
    g.bezierCurveTo(3, -17, 9 + flicker, -8, 0, 4);
    g.fillStyle = 'rgba(255, 149, 52, 0.72)';
    g.fill();

    g.beginPath();
    g.moveTo(0, 2);
    g.bezierCurveTo(-4, -7, -1, -16, 0, -20 - flicker * 0.75);
    g.bezierCurveTo(2, -12, 5, -4, 0, 2);
    g.fillStyle = 'rgba(255, 232, 172, 0.92)';
    g.fill();
    g.restore();

    /* 余烬 */
    g.save();
    g.globalCompositeOperation = 'screen';
    for (var i = 0; i < 3; i++) {
      var seed = brazier.index * 7 + i * 19;
      var age = (time * (0.25 + i * 0.09) + seed * 0.13) % 1;
      var ex = x + Math.sin(time * 1.8 + seed) * (9 + i * 3);
      var ey = y - 12 - age * (48 + i * 8);
      g.globalAlpha = (1 - age) * 0.7;
      g.fillStyle = '#ffcf7a';
      g.beginPath();
      g.arc(ex, ey, 1.2 + i * 0.2, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawBrazierAura(g, brazier, time) {
    if (!brazier.lit || brazier.suppressed > 0) return;
    var radius = gameState ? CORE.getBrazierAuraRadius(gameState) : B.BRAZIER_AURA_RADIUS;
    var pulse = 1 + Math.sin(time * 2.2 + brazier.index) * 0.035;
    g.save();
    g.globalCompositeOperation = 'screen';
    drawGlow(g, glowWarm, brazier.x, brazier.y, 172 * pulse, 0.13);
    g.strokeStyle = 'rgba(255, 203, 124, 0.075)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(brazier.x, brazier.y, radius, 0, TAU);
    g.stroke();
    g.setLineDash([2, 10]);
    g.strokeStyle = 'rgba(255, 215, 153, 0.12)';
    g.beginPath();
    g.arc(brazier.x, brazier.y, radius - 5, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }

  function drawLighthouse(g, time) {
    var x = B.LIGHTHOUSE_X;
    var y = B.LIGHTHOUSE_Y;
    var lit = gameState ? CORE.getLitCount(gameState) : 0;
    var allLit = lit === 4;
    var finale = gameState && gameState.phase === 'finale';
    var victory = gameState && gameState.phase === 'victory';
    var pulse = 0.5 + Math.sin(time * 1.9) * 0.5;
    var typeConf = gameState ? CORE.getLighthouseConfig(gameState) : CORE.LIGHTHOUSE_TYPES.ember;

    g.save();
    g.translate(x, y);

    /* 塔基 */
    g.beginPath();
    g.arc(0, 0, 48, 0, TAU);
    g.fillStyle = 'rgba(17, 33, 35, 0.96)';
    g.fill();
    g.strokeStyle = 'rgba(177, 171, 135, 0.19)';
    g.lineWidth = 1.4;
    g.stroke();

    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * TAU + Math.PI / 8;
      g.save();
      g.rotate(a);
      g.fillStyle = i % 2 ? 'rgba(36, 51, 48, 0.8)' : 'rgba(28, 43, 42, 0.86)';
      g.fillRect(-7, -44, 14, 15);
      g.strokeStyle = 'rgba(171, 168, 134, 0.09)';
      g.strokeRect(-7, -44, 14, 15);
      g.restore();
    }

    g.beginPath();
    g.arc(0, 0, 33, 0, TAU);
    g.fillStyle = 'rgba(7, 16, 19, 0.96)';
    g.fill();

    var coreAlpha = finale || victory ? 0.9 : allLit ? 0.5 : 0.16;
    var coreRadius = finale ? 18 + pulse * 4 : 15;
    var core = g.createRadialGradient(0, 0, 1, 0, 0, coreRadius);
    core.addColorStop(0, 'rgba(255, 244, 206, ' + coreAlpha + ')');
    core.addColorStop(0.35, 'rgba(255, 193, 107, ' + (coreAlpha * 0.8) + ')');
    core.addColorStop(0.8, 'rgba(255, 142, 48, ' + (coreAlpha * 0.24) + ')');
    core.addColorStop(1, 'rgba(255, 127, 32, 0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, coreRadius, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(255, 218, 156, ' + (allLit ? 0.34 : 0.16) + ')';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 21, 0, TAU);
    g.stroke();

    g.save();
    g.globalAlpha = allLit ? 0.72 : 0.34;
    g.strokeStyle = typeConf.accent;
    g.lineWidth = 1.4;
    g.setLineDash([3, 6]);
    g.beginPath();
    g.arc(0, 0, 25, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    /* 十字准星般的灯窗 */
    g.strokeStyle = 'rgba(255, 213, 141, ' + (allLit ? 0.26 : 0.08) + ')';
    g.beginPath();
    g.moveTo(-27, 0);
    g.lineTo(27, 0);
    g.moveTo(0, -27);
    g.lineTo(0, 27);
    g.stroke();

    if (allLit && !finale && !victory) {
      g.strokeStyle = 'rgba(255, 200, 111, ' + (0.22 + pulse * 0.18) + ')';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, 60 + pulse * 5, 0, TAU);
      g.stroke();
      g.setLineDash([2, 9]);
      g.strokeStyle = 'rgba(255, 226, 174, 0.17)';
      g.beginPath();
      g.arc(0, 0, 68 + pulse * 5, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }

    if (gameState && !finale && !victory) {
      g.globalAlpha = 0.38;
      g.fillStyle = typeConf.accent;
      g.font = '9px "Songti SC", "STSong", serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText('长灯 · ' + typeConf.tag, 0, 57);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function drawLighthouseLight(g, time) {
    if (!gameState) return;
    var phase = gameState.phase;
    var lit = CORE.getLitCount(gameState);
    var x = B.LIGHTHOUSE_X;
    var y = B.LIGHTHOUSE_Y;

    if (phase !== 'finale' && phase !== 'victory') {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, lit === 4 ? glowWarm : glowBlue, x, y, lit === 4 ? 150 : 260, lit === 4 ? 0.08 : 0.055);
      g.restore();
    }

    if (phase === 'finale' || phase === 'victory') {
      var radius = phase === 'victory' ? 380 : gameState.lighthouse.auraRadius + 70;
      var pulse = 0.82 + Math.sin(time * 3.2) * 0.08;
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowWarm, x, y, radius * pulse, phase === 'victory' ? 0.28 : 0.19);
      g.strokeStyle = 'rgba(255, 204, 130, 0.13)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, gameState.lighthouse.auraRadius, 0, TAU);
      g.stroke();
      g.setLineDash([2, 12]);
      g.strokeStyle = 'rgba(255, 231, 183, 0.12)';
      g.beginPath();
      g.arc(x, y, gameState.lighthouse.auraRadius - 7, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    } else if (lit === 4) {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowWarm, x, y, 92 + Math.sin(time * 2) * 8, 0.12);
      g.restore();
    }
  }

  function drawLighthouseBeamTitle(g, time) {
    var x = B.LIGHTHOUSE_X;
    var y = B.LIGHTHOUSE_Y;
    var baseAngle = time * 0.075 - 0.5;
    g.save();
    g.globalCompositeOperation = 'screen';
    for (var side = -1; side <= 1; side += 2) {
      var angle = baseAngle + side * 0.075;
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      var grad = g.createLinearGradient(0, 0, 560, 0);
      grad.addColorStop(0, 'rgba(255, 223, 164, 0.16)');
      grad.addColorStop(0.22, 'rgba(255, 193, 112, 0.07)');
      grad.addColorStop(1, 'rgba(255, 170, 75, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 560, -0.055, 0.055);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.restore();

    g.save();
    g.globalCompositeOperation = 'screen';
    drawGlow(g, glowWarm, x, y, 150, 0.2);
    drawGlow(g, glowPale, x, y, 55, 0.35);
    g.restore();
  }

  function drawPickups(g, time) {
    if (!gameState) return;
    for (var i = 0; i < gameState.pickups.length; i++) {
      var pickup = gameState.pickups[i];
      var remaining = pickup.ttl - pickup.age;
      var blink = remaining < 3 ? (Math.sin(time * 18) > -0.2 ? 1 : 0.28) : 1;
      var bob = Math.sin(time * 3 + i * 1.4) * 3;
      g.save();
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = blink;
      drawGlow(g, glowWarm, pickup.x, pickup.y + bob, 28, 0.64);
      g.translate(pickup.x, pickup.y + bob);
      g.rotate(time * 0.9 + i);
      g.fillStyle = '#ffd99c';
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4, 0);
      g.lineTo(0, 6);
      g.lineTo(-4, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255, 248, 220, 0.92)';
      g.beginPath();
      g.arc(0, 0, 1.8, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  function drawCargo(g, time) {
    if (!gameState || !gameState.expedition || !gameState.expedition.cargo) return;
    var cargo = gameState.expedition.cargo;
    var player = gameState.player;
    var carried = cargo.carried;
    var x = carried ? player.x - player.aimX * 20 : cargo.x;
    var y = carried ? player.y - player.aimY * 20 + Math.sin(time * 5) * 1.5 : cargo.y;
    var pulse = 0.7 + Math.sin(time * 3.5) * 0.15;

    g.save();
    if (!carried) {
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowWarm, x, y, 72 * pulse, 0.24);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(255, 213, 143, ' + (0.3 + pulse * 0.2) + ')';
      g.lineWidth = 1;
      g.setLineDash([2, 7]);
      g.beginPath();
      g.arc(x, y, 36 + pulse * 5, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }

    g.translate(x, y);
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    g.beginPath();
    g.ellipse(0, 12, 17, 7, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#2a2017';
    g.beginPath();
    g.roundRect ? g.roundRect(-13, -13, 26, 25, 5) : g.rect(-13, -13, 26, 25);
    g.fill();
    g.strokeStyle = 'rgba(255, 204, 126, 0.55)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = 'rgba(255, 168, 68, 0.62)';
    g.beginPath();
    g.ellipse(0, -13, 10, 4, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(217, 181, 116, 0.4)';
    g.beginPath();
    g.moveTo(-13, -4);
    g.lineTo(13, -4);
    g.moveTo(-13, 4);
    g.lineTo(13, 4);
    g.stroke();
    g.fillStyle = '#ffe2a3';
    g.beginPath();
    g.arc(0, 0, 2.2, 0, TAU);
    g.fill();
    g.restore();

    if (!carried) {
      g.save();
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255, 216, 148, 0.82)';
      g.font = '9px "Songti SC", "STSong", serif';
      g.fillText('长灯油', x, y + 30);
      g.restore();
    }
  }

  function drawFogHazards(g, time) {
    if (!gameState) return;
    var player = gameState.player;
    var i;

    for (i = 0; i < gameState.fogZones.length; i++) {
      var fog = gameState.fogZones[i];
      var fade = Math.min(1, fog.age * 2.5, fog.ttl * 0.7);
      var gradient = g.createRadialGradient(fog.x, fog.y, 4, fog.x, fog.y, fog.radius);
      gradient.addColorStop(0, 'rgba(106, 139, 127, ' + (0.18 * fade) + ')');
      gradient.addColorStop(0.58, 'rgba(80, 105, 112, ' + (0.14 * fade) + ')');
      gradient.addColorStop(1, 'rgba(55, 76, 87, 0)');
      g.fillStyle = gradient;
      g.beginPath();
      g.arc(fog.x, fog.y, fog.radius, 0, TAU);
      g.fill();
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowBlue, fog.x, fog.y, fog.radius * 0.95, 0.08 * fade);
      g.restore();
      g.strokeStyle = 'rgba(159, 224, 212, ' + (0.16 * fade) + ')';
      g.lineWidth = 1;
      g.setLineDash([3, 9]);
      g.beginPath();
      g.arc(fog.x, fog.y, fog.radius - 4, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(185, 230, 218, ' + (0.35 * fade) + ')';
      g.font = '8px "Songti SC", "STSong", serif';
      g.textAlign = 'center';
      g.fillText('雾', fog.x, fog.y - 3);
      var hpWidth = 44;
      g.fillStyle = 'rgba(4, 12, 16, 0.55)';
      g.fillRect(fog.x - hpWidth / 2, fog.y + 10, hpWidth, 2);
      g.fillStyle = 'rgba(159, 224, 212, 0.7)';
      g.fillRect(fog.x - hpWidth / 2, fog.y + 10, hpWidth * Math.max(0, fog.hp / fog.maxHp), 2);
    }

    for (i = 0; i < gameState.enemies.length; i++) {
      var enemy = gameState.enemies[i];
      if (enemy.type !== 'weaver' || enemy.fogWindup <= 0) continue;
      var progress = 1 - enemy.fogWindup / B.FOG_WINDUP;
      var tx = enemy.fogTargetX;
      var ty = enemy.fogTargetY;
      g.save();
      g.strokeStyle = 'rgba(159, 224, 212, ' + (0.26 + progress * 0.3) + ')';
      g.fillStyle = 'rgba(104, 146, 138, 0.07)';
      g.lineWidth = 1.3;
      g.setLineDash([4, 7]);
      g.beginPath();
      g.arc(tx, ty, B.FOG_RADIUS, 0, TAU);
      g.fill();
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(224, 242, 229, 0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(tx, ty, B.FOG_RADIUS - 8, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      g.stroke();
      g.fillStyle = 'rgba(207, 239, 229, 0.9)';
      g.font = '9px "Songti SC", "STSong", serif';
      g.textAlign = 'center';
      g.fillText('雾', tx, ty + 3);
      g.restore();
    }

    if (player.fogged) {
      g.save();
      var tint = g.createRadialGradient(player.x, player.y, 20, player.x, player.y, 240);
      tint.addColorStop(0, 'rgba(87, 124, 114, 0.03)');
      tint.addColorStop(1, 'rgba(57, 85, 92, 0.14)');
      g.fillStyle = tint;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
  }

  function drawObjectiveHints(g, time) {
    if (!gameState || appState !== 'playing') return;
    var targets = CORE.getObjectiveTargets(gameState);
    if (!targets.length) return;
    var player = gameState.player;
    var guide = CORE.getLighthouseConfig(gameState).showGuide;
    var nearest = null;
    var nearestDistance = Infinity;
    var i;

    for (i = 0; i < targets.length; i++) {
      var target = targets[i];
      var distance = Math.hypot(target.x - player.x, target.y - player.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = target;
      }
      if (target.kind === 'brazier') continue;
      var color = target.kind === 'thief' ? '255, 207, 130' : '159, 224, 212';
      g.save();
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = 0.55 + Math.sin(time * 3 + i) * 0.12;
      drawGlow(g, target.kind === 'thief' ? glowWarm : glowBlue, target.x, target.y, 46, 0.2);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(' + color + ', 0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(target.x, target.y, 24, 0, TAU);
      g.stroke();
      g.fillStyle = 'rgba(' + color + ', 0.9)';
      g.beginPath();
      g.moveTo(target.x, target.y - 42);
      g.lineTo(target.x + 4, target.y - 35);
      g.lineTo(target.x, target.y - 28);
      g.lineTo(target.x - 4, target.y - 35);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(' + color + ', 0.78)';
      g.font = '8px "Songti SC", "STSong", serif';
      g.textAlign = 'center';
      g.fillText(target.label, target.x, target.y + 37);
      g.restore();
    }

    if (!guide || !nearest) return;
    var dx = nearest.x - player.x;
    var dy = nearest.y - player.y;
    var length = Math.hypot(dx, dy) || 1;
    var ux = dx / length;
    var uy = dy / length;
    var startX = player.x + ux * 28;
    var startY = player.y + uy * 28;
    g.save();
    g.globalCompositeOperation = 'screen';
    g.strokeStyle = 'rgba(159, 224, 212, 0.32)';
    g.lineWidth = 1;
    g.setLineDash([4, 10]);
    g.lineDashOffset = -time * 28;
    g.beginPath();
    g.moveTo(startX, startY);
    g.lineTo(nearest.x - ux * 20, nearest.y - uy * 20);
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
    var chevronX = player.x + ux * Math.min(80, length * 0.25);
    var chevronY = player.y + uy * Math.min(80, length * 0.25);
    g.save();
    g.translate(chevronX, chevronY);
    g.rotate(Math.atan2(uy, ux));
    g.fillStyle = 'rgba(159, 224, 212, 0.8)';
    g.beginPath();
    g.moveTo(8, 0);
    g.lineTo(-4, -5);
    g.lineTo(-1, 0);
    g.lineTo(-4, 5);
    g.closePath();
    g.fill();
    g.restore();
    g.restore();
  }

  function drawTerrainStatus(g, time) {
    if (!gameState) return;
    var player = gameState.player;
    var label = '';
    if (player.wading) label = '涉水 · 灯油流失';
    else if (player.fogged) label = '雾中 · 减速';
    if (!label) return;
    g.save();
    g.textAlign = 'center';
    g.font = '9px "Songti SC", "STSong", serif';
    g.fillStyle = player.wading ? 'rgba(167, 218, 226, 0.8)' : 'rgba(185, 230, 218, 0.82)';
    g.fillText(label, player.x, player.y - 34);
    if (player.wading) {
      g.strokeStyle = 'rgba(167, 218, 226, 0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(player.x, player.y + 12, 24 + Math.sin(time * 5) * 3, 8, 0, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  function drawEnemy(g, enemy, time) {
    var radius = enemy.radius;
    var wobble = Math.sin(time * 3.1 + enemy.phase) * 0.08 + Math.sin(time * 5.7 + enemy.phase * 2) * 0.04;
    var facing = Math.atan2(
      (gameState ? gameState.player.y : 360) - enemy.y,
      (gameState ? gameState.player.x : 640) - enemy.x
    );

    g.save();
    g.translate(enemy.x, enemy.y);

    g.fillStyle = 'rgba(0, 0, 0, 0.34)';
    g.beginPath();
    g.ellipse(0, radius * 0.72, radius * 1.2, radius * 0.42, 0, 0, TAU);
    g.fill();

    g.beginPath();
    var points = enemy.type === 'brute' ? 12 : 9;
    for (var i = 0; i < points; i++) {
      var angle = (i / points) * TAU;
      var edge = radius * (0.82 + wobble + Math.sin(angle * 3 + enemy.age * 2.2 + enemy.phase) * 0.14);
      var px = Math.cos(angle) * edge;
      var py = Math.sin(angle) * edge * 1.03;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();

    var body = g.createRadialGradient(0, -radius * 0.25, 1, 0, 0, radius * 1.25);
    if (enemy.type === 'brute') {
      body.addColorStop(0, '#3a2348');
      body.addColorStop(0.55, '#1c1228');
      body.addColorStop(1, '#0a0a11');
    } else if (enemy.type === 'wraith') {
      body.addColorStop(0, '#342b48');
      body.addColorStop(0.6, '#181421');
      body.addColorStop(1, '#090a10');
    } else if (enemy.type === 'thief') {
      body.addColorStop(0, '#49304f');
      body.addColorStop(0.5, '#24142e');
      body.addColorStop(1, '#0b0811');
    } else if (enemy.type === 'weaver') {
      body.addColorStop(0, '#294b49');
      body.addColorStop(0.55, '#152b2e');
      body.addColorStop(1, '#080f13');
    } else {
      body.addColorStop(0, '#34213f');
      body.addColorStop(0.65, '#171020');
      body.addColorStop(1, '#09090f');
    }
    g.fillStyle = body;
    g.fill();
    var outlineColor = enemy.type === 'weaver'
      ? 'rgba(141, 201, 183, 0.46)'
      : enemy.type === 'thief' ? 'rgba(206, 155, 112, 0.52)' : 'rgba(168, 115, 190, 0.48)';
    g.strokeStyle = enemy.flash > 0 ? 'rgba(255, 242, 211, 0.9)' : outlineColor;
    g.lineWidth = enemy.flash > 0 ? 1.5 : 1.05;
    g.stroke();

    if (enemy.slowFactor > 0.12) {
      g.strokeStyle = 'rgba(255, 199, 117, ' + Math.min(0.38, enemy.slowFactor * 0.8) + ')';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(0, 0, radius + 2.5, 0, TAU);
      g.stroke();
    }

    if (enemy.flash > 0) {
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = Math.min(1, enemy.flash * 8);
      g.fillStyle = '#fff1ce';
      g.beginPath();
      g.arc(0, 0, radius * 0.9, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    /* 眼睛 */
    var eyeSpread = enemy.type === 'brute' ? 7 : 4.5;
    var eyeForward = radius * 0.24;
    var ex = Math.cos(facing) * eyeForward;
    var ey = Math.sin(facing) * eyeForward;
    var sideX = Math.cos(facing + Math.PI / 2) * eyeSpread;
    var sideY = Math.sin(facing + Math.PI / 2) * eyeSpread;
    var blink = Math.sin(time * 1.4 + enemy.phase) > -0.88 ? 1 : 0.2;
    var eyeColor = enemy.type === 'weaver'
      ? 'rgba(159, 224, 212, ' + (0.7 * blink) + ')'
      : enemy.type === 'thief'
        ? 'rgba(255, 208, 132, ' + (0.72 * blink) + ')'
        : 'rgba(255, 161, 116, ' + (0.66 * blink) + ')';
    g.fillStyle = eyeColor;
    g.beginPath();
    g.moveTo(ex + sideX + 1.35, ey + sideY);
    g.arc(ex + sideX, ey + sideY, 1.35, 0, TAU);
    g.moveTo(ex - sideX + 1.35, ey - sideY);
    g.arc(ex - sideX, ey - sideY, 1.35, 0, TAU);
    g.fill();

    if (enemy.type === 'thief') {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowWarm, 0, -radius * 0.4, radius * 2.4, 0.16);
      g.fillStyle = 'rgba(255, 217, 151, 0.92)';
      g.beginPath();
      g.moveTo(0, -radius - 2);
      g.quadraticCurveTo(radius * 0.3, -radius * 0.55, 0, -radius * 0.2);
      g.quadraticCurveTo(-radius * 0.3, -radius * 0.55, 0, -radius - 2);
      g.fill();
      g.restore();
    } else if (enemy.type === 'weaver') {
      g.save();
      g.globalCompositeOperation = 'screen';
      drawGlow(g, glowBlue, 0, 0, radius * 2.8, 0.1);
      g.fillStyle = 'rgba(159, 224, 212, 0.18)';
      g.beginPath();
      g.arc(0, 0, radius * 0.72, 0, TAU);
      g.fill();
      g.restore();
    }

    if (enemy.channel > 0 && enemy.channelBrazierId && gameState) {
      var channelBrazier = null;
      for (var cb = 0; cb < gameState.braziers.length; cb++) {
        if (gameState.braziers[cb].id === enemy.channelBrazierId) {
          channelBrazier = gameState.braziers[cb];
          break;
        }
      }
      if (channelBrazier) {
        var tetherX = channelBrazier.x - enemy.x;
        var tetherY = channelBrazier.y - enemy.y;
        g.strokeStyle = 'rgba(224, 171, 241, 0.5)';
        g.lineWidth = 1;
        g.setLineDash([3, 5]);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(tetherX, tetherY);
        g.stroke();
        g.setLineDash([]);
        g.strokeStyle = 'rgba(255, 210, 136, 0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, radius + 7, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, enemy.channel / CORE.BALANCE.THIEF_STEAL_TIME));
        g.stroke();
      }
    }

    if (enemy.quest) {
      g.save();
      g.strokeStyle = 'rgba(255, 211, 142, 0.9)';
      g.fillStyle = 'rgba(255, 211, 142, 0.14)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, -radius - 22);
      g.lineTo(5, -radius - 17);
      g.lineTo(0, -radius - 12);
      g.lineTo(-5, -radius - 17);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    g.strokeStyle = 'rgba(188, 123, 177, ' + (0.08 + Math.min(0.14, enemy.slowFactor * 0.2)) + ')';
    g.beginPath();
    g.moveTo(0, radius * 0.6);
    g.quadraticCurveTo(radius * 0.2, radius * 0.9, radius * 0.05, radius * 1.25);
    g.stroke();

    if (enemy.type === 'brute' && enemy.hp < enemy.maxHp) {
      var barWidth = radius * 1.8;
      g.fillStyle = 'rgba(0, 0, 0, 0.55)';
      g.fillRect(-barWidth / 2, -radius - 10, barWidth, 2.5);
      g.fillStyle = '#d5965c';
      g.fillRect(-barWidth / 2, -radius - 10, barWidth * (enemy.hp / enemy.maxHp), 2.5);
    }

    g.restore();
  }

  function drawPlayer(g, time) {
    if (!gameState) return;
    var player = gameState.player;
    var aimAngle = Math.atan2(player.aimY, player.aimX);
    var bob = player.moving ? Math.sin(time * 14) * 1.2 : Math.sin(time * 3.2) * 0.55;
    var blink = player.invuln > 0 && Math.floor(time * 22) % 2 === 0;
    var x = player.x;
    var y = player.y + bob;

    g.save();
    if (blink) g.globalAlpha = 0.55;

    g.fillStyle = 'rgba(0, 0, 0, 0.4)';
    g.beginPath();
    g.ellipse(x, y + 14, 19, 8.5, 0, 0, TAU);
    g.fill();

    g.save();
    g.translate(x, y);
    g.rotate(aimAngle);
    g.scale(1.12, 1.12);

    /* 斗篷/身体 */
    g.beginPath();
    g.moveTo(-9, 8);
    g.quadraticCurveTo(-17, 16, -11, 21);
    g.quadraticCurveTo(0, 26, 11, 21);
    g.quadraticCurveTo(17, 16, 9, 8);
    g.quadraticCurveTo(6, -4, 0, -7);
    g.quadraticCurveTo(-6, -4, -9, 8);
    g.closePath();
    g.fillStyle = player.hitFlash > 0 ? '#7b4a43' : '#1b4148';
    g.fill();
    g.strokeStyle = player.hitFlash > 0
      ? 'rgba(255, 188, 148, 0.8)'
      : 'rgba(166, 213, 188, 0.55)';
    g.lineWidth = 1.1;
    g.stroke();

    /* 斗篷的暖色反光 */
    g.beginPath();
    g.moveTo(-8, 10);
    g.quadraticCurveTo(0, 17, 10, 10);
    g.strokeStyle = 'rgba(255, 190, 110, 0.2)';
    g.lineWidth = 1.4;
    g.stroke();

    /* 围巾 */
    g.beginPath();
    g.moveTo(-7, 2);
    g.quadraticCurveTo(0, 5, 7, 2);
    g.strokeStyle = '#c67c54';
    g.lineWidth = 2.8;
    g.lineCap = 'round';
    g.stroke();

    /* 兜帽 */
    g.beginPath();
    g.arc(2, -5, 8.5, 0, TAU);
    g.fillStyle = player.hitFlash > 0 ? '#9d6754' : '#10272b';
    g.fill();
    g.strokeStyle = 'rgba(213, 209, 162, 0.48)';
    g.lineWidth = 0.9;
    g.stroke();

    g.beginPath();
    g.arc(3.5, -5.4, 5.1, 0, TAU);
    g.fillStyle = '#050d11';
    g.fill();

    /* 兜帽下的一点暖光，帮助玩家定位 */
    g.fillStyle = 'rgba(255, 224, 172, 0.78)';
    g.beginPath();
    g.arc(6.4, -4.5, 1.2, 0, TAU);
    g.fill();

    /* 提灯手臂 */
    g.beginPath();
    g.moveTo(4, 3);
    g.lineTo(18, 2);
    g.strokeStyle = '#466e64';
    g.lineWidth = 3;
    g.stroke();

    /* 灯柄 */
    g.beginPath();
    g.moveTo(20, 2);
    g.lineTo(23, 8);
    g.strokeStyle = '#9b7b4a';
    g.lineWidth = 1;
    g.stroke();

    g.restore();

    /* 提灯 */
    var lanternX = x + Math.cos(aimAngle) * 24;
    var lanternY = y + Math.sin(aimAngle) * 24 + Math.sin(time * 4) * 0.7;
    g.save();
    g.globalCompositeOperation = 'screen';
    drawGlow(g, glowWarm, lanternX, lanternY, 54, 0.6);
    drawGlow(g, glowPale, lanternX, lanternY, 18, 0.75);
    g.restore();

    g.save();
    g.translate(lanternX, lanternY);
    g.fillStyle = '#1a201c';
    g.fillRect(-3.2, -4.5, 6.4, 8);
    g.strokeStyle = 'rgba(255, 220, 154, 0.86)';
    g.lineWidth = 0.8;
    g.strokeRect(-3.2, -4.5, 6.4, 8);
    g.fillStyle = '#ffeec2';
    g.fillRect(-1.7, -2.8, 3.4, 4.6);
    g.restore();

    g.restore();
  }

  function drawPlayerLight(g, time) {
    if (!gameState) return;
    var player = gameState.player;
    g.save();
    g.globalCompositeOperation = 'screen';
    var pulse = 0.8 + Math.sin(time * 4.2) * 0.06;
    drawGlow(g, glowWarm, player.x, player.y, 172 * pulse, 0.18);
    drawGlow(g, glowWarm, player.x + player.aimX * 24, player.y + player.aimY * 24, 78, 0.28);
    drawGlow(g, glowPale, player.x + player.aimX * 24, player.y + player.aimY * 24, 25, 0.35);
    g.restore();
  }

  function drawEnemyLights(g, time) {
    if (!gameState || gameState.enemies.length === 0) return;
    var player = gameState.player;
    g.save();
    g.globalCompositeOperation = 'screen';
    for (var i = 0; i < gameState.enemies.length; i++) {
      var enemy = gameState.enemies[i];
      if (enemy.x < -60 || enemy.x > W + 60 || enemy.y < -60 || enemy.y > H + 60) continue;
      var dx = player.x - enemy.x;
      var dy = player.y - enemy.y;
      var distance = Math.hypot(dx, dy) || 1;
      var facing = Math.atan2(dy, dx);
      var threat = clamp(1 - distance / 520, 0.2, 1);
      var enemyGlow = enemy.type === 'thief' ? glowWarm : enemy.type === 'weaver' ? glowBlue : glowPurple;
      drawGlow(g, enemyGlow, enemy.x, enemy.y, enemy.radius * (4.1 + threat), 0.12 + threat * 0.1);

      /* 夜里的轮廓：即使不在灯光中，也能看见逼近的影子 */
      g.save();
      g.translate(enemy.x, enemy.y);
      g.beginPath();
      var outlinePoints = enemy.type === 'brute' ? 12 : 9;
      for (var p = 0; p < outlinePoints; p++) {
        var outlineAngle = (p / outlinePoints) * TAU;
        var outlineRadius = enemy.radius * (0.9 + Math.sin(outlineAngle * 3 + enemy.age * 2.2 + enemy.phase) * 0.12);
        var ox = Math.cos(outlineAngle) * outlineRadius;
        var oy = Math.sin(outlineAngle) * outlineRadius * 1.03;
        if (p === 0) g.moveTo(ox, oy);
        else g.lineTo(ox, oy);
      }
      g.closePath();
      g.strokeStyle = enemy.type === 'weaver'
        ? 'rgba(141, 201, 183, ' + (0.28 + threat * 0.16) + ')'
        : enemy.type === 'thief'
          ? 'rgba(221, 170, 112, ' + (0.28 + threat * 0.16) + ')'
          : 'rgba(188, 131, 208, ' + (0.26 + threat * 0.16) + ')';
      g.lineWidth = 1.15;
      g.stroke();
      g.restore();

      var eyeSpread = enemy.type === 'brute' ? 7 : 4.5;
      var eyeForward = enemy.radius * 0.24;
      var ex = Math.cos(facing) * eyeForward;
      var ey = Math.sin(facing) * eyeForward;
      var sideX = Math.cos(facing + Math.PI / 2) * eyeSpread;
      var sideY = Math.sin(facing + Math.PI / 2) * eyeSpread;
      var blink = Math.sin(time * 1.4 + enemy.phase) > -0.88 ? 1 : 0.2;
      g.globalAlpha = (0.35 + threat * 0.5) * blink;
      g.fillStyle = enemy.type === 'brute'
        ? '#ff9b73'
        : enemy.type === 'weaver' ? '#9fe0d4'
          : enemy.type === 'thief' ? '#ffd28a' : '#e9a585';
      g.beginPath();
      g.moveTo(enemy.x + ex + sideX + 1.4, enemy.y + ey + sideY);
      g.arc(enemy.x + ex + sideX, enemy.y + ey + sideY, 1.4, 0, TAU);
      g.moveTo(enemy.x + ex - sideX + 1.2, enemy.y + ey - sideY);
      g.arc(enemy.x + ex - sideX, enemy.y + ey - sideY, 1.2, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawBeam(g, time) {
    if (!gameState) return;
    var player = gameState.player;
    if (!player.beamActive) return;
    var originX = player.x + player.aimX * 22;
    var originY = player.y + player.aimY * 22;
    var angle = Math.atan2(player.aimY, player.aimX);
    var flicker = 0.9 + Math.sin(time * 31) * 0.05 + Math.sin(time * 17.3) * 0.025;

    g.save();
    g.globalCompositeOperation = 'screen';
    g.translate(originX, originY);
    g.rotate(angle);

    var grad = g.createLinearGradient(0, 0, B.BEAM_RANGE, 0);
    grad.addColorStop(0, 'rgba(255, 230, 174, ' + (0.36 * flicker) + ')');
    grad.addColorStop(0.28, 'rgba(255, 193, 112, ' + (0.2 * flicker) + ')');
    grad.addColorStop(0.7, 'rgba(255, 164, 67, ' + (0.07 * flicker) + ')');
    grad.addColorStop(1, 'rgba(255, 145, 46, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, B.BEAM_RANGE, -B.BEAM_HALF_ANGLE, B.BEAM_HALF_ANGLE);
    g.closePath();
    g.fill();

    var coreGrad = g.createLinearGradient(0, 0, B.BEAM_RANGE * 0.9, 0);
    coreGrad.addColorStop(0, 'rgba(255, 249, 218, ' + (0.13 * flicker) + ')');
    coreGrad.addColorStop(1, 'rgba(255, 201, 116, 0)');
    g.fillStyle = coreGrad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, B.BEAM_RANGE * 0.9, -B.BEAM_HALF_ANGLE * 0.32, B.BEAM_HALF_ANGLE * 0.32);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(255, 224, 160, ' + (0.11 * flicker) + ')';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(-B.BEAM_HALF_ANGLE) * B.BEAM_RANGE, Math.sin(-B.BEAM_HALF_ANGLE) * B.BEAM_RANGE);
    g.moveTo(0, 0);
    g.lineTo(Math.cos(B.BEAM_HALF_ANGLE) * B.BEAM_RANGE, Math.sin(B.BEAM_HALF_ANGLE) * B.BEAM_RANGE);
    g.stroke();

    g.restore();
  }

  var shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = W;
  shadeCanvas.height = H;
  var shadeCtx = shadeCanvas.getContext('2d');

  function punchLight(g, x, y, radius, alpha) {
    var grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, ' + alpha + ')');
    grad.addColorStop(0.4, 'rgba(0, 0, 0, ' + alpha * 0.7 + ')');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.fill();
  }

  function drawShade(time) {
    shadeCtx.clearRect(0, 0, W, H);
    shadeCtx.globalCompositeOperation = 'source-over';
    var shade = shadeCtx.createRadialGradient(640, 360, 80, 640, 360, 760);
    shade.addColorStop(0, 'rgba(2, 6, 12, 0.13)');
    shade.addColorStop(0.62, 'rgba(1, 5, 10, 0.25)');
    shade.addColorStop(1, 'rgba(0, 3, 8, 0.52)');
    shadeCtx.fillStyle = shade;
    shadeCtx.fillRect(0, 0, W, H);

    shadeCtx.globalCompositeOperation = 'destination-out';
    if (gameState) {
      punchLight(shadeCtx, gameState.player.x, gameState.player.y, 158, 0.58);
      punchLight(shadeCtx, B.LIGHTHOUSE_X, B.LIGHTHOUSE_Y, 145, 0.28);
      var auraRadius = CORE.getBrazierAuraRadius(gameState);
      for (var i = 0; i < gameState.braziers.length; i++) {
        var brazier = gameState.braziers[i];
        if (brazier.suppressed > 0) punchLight(shadeCtx, brazier.x, brazier.y, 80, 0.18);
        else if (brazier.lit) punchLight(shadeCtx, brazier.x, brazier.y, auraRadius + 115, 0.65);
        else punchLight(shadeCtx, brazier.x, brazier.y, 92, 0.26);
      }
      if (gameState.expedition && gameState.expedition.cargo) {
        var cargo = gameState.expedition.cargo;
        punchLight(shadeCtx, cargo.x, cargo.y, 64, 0.22);
      }
      if (gameState.phase === 'finale' || gameState.phase === 'victory') {
        punchLight(shadeCtx, B.LIGHTHOUSE_X, B.LIGHTHOUSE_Y, 330, 0.65);
      } else if (CORE.getLitCount(gameState) === 4) {
        punchLight(shadeCtx, B.LIGHTHOUSE_X, B.LIGHTHOUSE_Y, 150, 0.38);
      }

      if (gameState.player.beamActive) {
        var player = gameState.player;
        var originX = player.x + player.aimX * 22;
        var originY = player.y + player.aimY * 22;
        shadeCtx.save();
        shadeCtx.translate(originX, originY);
        shadeCtx.rotate(Math.atan2(player.aimY, player.aimX));
        var beamGrad = shadeCtx.createLinearGradient(0, 0, B.BEAM_RANGE, 0);
        beamGrad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
        beamGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.30)');
        beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        shadeCtx.fillStyle = beamGrad;
        shadeCtx.beginPath();
        shadeCtx.moveTo(0, 0);
        shadeCtx.arc(0, 0, B.BEAM_RANGE, -B.BEAM_HALF_ANGLE, B.BEAM_HALF_ANGLE);
        shadeCtx.closePath();
        shadeCtx.fill();
        shadeCtx.restore();
      }
    }
    shadeCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(shadeCanvas, 0, 0, W, H);
  }

  function drawVignette(g, warm) {
    g.save();
    var strength = warm ? 0.34 : 0.52;
    var vignette = g.createRadialGradient(640, 360, 190, 640, 360, 760);
    vignette.addColorStop(0, 'rgba(0, 4, 9, 0)');
    vignette.addColorStop(0.56, 'rgba(0, 3, 8, 0.08)');
    vignette.addColorStop(1, 'rgba(0, 2, 6, ' + strength + ')');
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);

    var top = g.createLinearGradient(0, 0, 0, 160);
    top.addColorStop(0, 'rgba(0, 3, 8, 0.34)');
    top.addColorStop(1, 'rgba(0, 3, 8, 0)');
    g.fillStyle = top;
    g.fillRect(0, 0, W, 160);
    g.restore();
  }

  function drawDawn(g) {
    if (!gameState) return;
    var progress = 0;
    if (gameState.phase === 'finale') progress = clamp(gameState.finaleTime / (gameState.finaleDuration || B.FINALE_DURATION), 0, 1);
    if (gameState.phase === 'victory') progress = 1;
    progress = Math.max(progress, dawnVisual);
    if (progress <= 0.01) return;
    g.save();
    var sky = g.createLinearGradient(0, 0, 0, H * 0.85);
    sky.addColorStop(0, 'rgba(255, 174, 108, ' + (0.2 * progress) + ')');
    sky.addColorStop(0.28, 'rgba(240, 142, 92, ' + (0.09 * progress) + ')');
    sky.addColorStop(0.7, 'rgba(129, 143, 127, ' + (0.025 * progress) + ')');
    sky.addColorStop(1, 'rgba(104, 131, 127, 0)');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H * 0.9);

    var horizon = g.createRadialGradient(B.LIGHTHOUSE_X, 520, 20, B.LIGHTHOUSE_X, 520, 520);
    horizon.addColorStop(0, 'rgba(255, 205, 138, ' + (0.14 * progress) + ')');
    horizon.addColorStop(1, 'rgba(255, 160, 82, 0)');
    g.fillStyle = horizon;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function drawInteractionRing(g, time) {
    if (!gameState || appState !== 'playing') return;
    var target = CORE.getInteractTarget(gameState);
    if (!target) return;
    var x;
    var y;
    var radius;
    var progress;
    if (target.type === 'brazier') {
      x = target.brazier.x;
      y = target.brazier.y;
      radius = 36;
      progress = target.progress;
      if (!target.canInteract) {
        g.strokeStyle = 'rgba(205, 106, 81, 0.65)';
      } else {
        g.strokeStyle = 'rgba(255, 215, 150, 0.9)';
      }
    } else {
      x = B.LIGHTHOUSE_X;
      y = B.LIGHTHOUSE_Y;
      radius = 64;
      progress = target.progress;
      g.strokeStyle = 'rgba(255, 227, 175, 0.9)';
    }

    g.save();
    g.lineCap = 'round';
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.stroke();

    g.strokeStyle = target.type === 'brazier' && !target.canInteract
      ? 'rgba(215, 112, 85, 0.35)'
      : 'rgba(255, 208, 135, 0.24)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.stroke();

    if (progress > 0.001) {
      g.strokeStyle = target.type === 'brazier' && !target.canInteract
        ? 'rgba(220, 115, 86, 0.9)'
        : 'rgba(255, 225, 166, 0.96)';
      g.lineWidth = 2.6;
      g.beginPath();
      g.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      g.stroke();
    } else {
      var pulse = 0.5 + Math.sin(time * 3) * 0.5;
      g.globalAlpha = 0.2 + pulse * 0.25;
      g.strokeStyle = 'rgba(255, 209, 135, 0.8)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, radius + 3 + pulse * 3, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  function renderGame(time, dt) {
    if (!gameState) {
      renderTitle(time, dt);
      return;
    }
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#040a12';
    ctx.fillRect(0, 0, W, H);

    var shakeX = 0;
    var shakeY = 0;
    if (shake > 0.1) {
      shakeX = Math.sin(time * 91.3) * shake * 0.55;
      shakeY = Math.cos(time * 77.7) * shake * 0.35;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
    drawFog(ctx, time);

    var braziers = gameState.braziers;
    for (var i = 0; i < braziers.length; i++) {
      drawBrazierAura(ctx, braziers[i], time);
      drawBrazierBase(ctx, braziers[i], time);
    }

    drawLighthouse(ctx, time);
    drawPickups(ctx, time);

    var drawables = [];
    for (var e = 0; e < gameState.enemies.length; e++) {
      drawables.push({ y: gameState.enemies[e].y, kind: 'enemy', ref: gameState.enemies[e] });
    }
    drawables.push({ y: gameState.player.y + 6, kind: 'player', ref: gameState.player });
    drawables.sort(function (a, b) { return a.y - b.y; });
    for (var d = 0; d < drawables.length; d++) {
      if (drawables[d].kind === 'enemy') drawEnemy(ctx, drawables[d].ref, time);
      else drawPlayer(ctx, time);
    }

    for (var b = 0; b < braziers.length; b++) {
      drawBrazierFlame(ctx, braziers[b], time);
    }
    drawCargo(ctx, time);

    if (fgCanvas) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.drawImage(fgCanvas, 0, 0, W, H);
      ctx.restore();
    }

    drawShade(time);
    drawBeam(ctx, time);
    drawPlayerLight(ctx, time);
    drawLighthouseLight(ctx, time);
    drawEnemyLights(ctx, time);
    drawFogHazards(ctx, time);
    drawObjectiveHints(ctx, time);
    drawTerrainStatus(ctx, time);

    for (var l = 0; l < braziers.length; l++) {
      if (braziers[l].lit && braziers[l].suppressed <= 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        drawGlow(ctx, glowWarm, braziers[l].x, braziers[l].y, 90, 0.08);
        ctx.restore();
      }
    }

    drawParticles(ctx);
    drawVignette(ctx, gameState.phase === 'victory');
    drawDawn(ctx);
    drawInteractionRing(ctx, time);

    if (appState === 'ending' || appState === 'victory') {
      var glowAlpha = appState === 'victory' ? 0.06 : 0.02;
      ctx.fillStyle = 'rgba(255, 187, 105, ' + glowAlpha + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  /* ============================================================
     绘制：标题
     ============================================================ */

  function initTitleMotes() {
    titleMotes.length = 0;
    var rnd = makeRng(0x70a1c3);
    for (var i = 0; i < 68; i++) {
      titleMotes.push({
        x: 180 + rnd() * (W - 360),
        y: rnd() * H,
        vx: (rnd() - 0.5) * 8,
        vy: -5 - rnd() * 13,
        size: 0.7 + rnd() * 1.9,
        phase: rnd() * TAU,
        alpha: 0.2 + rnd() * 0.6,
        speed: 0.4 + rnd() * 0.8
      });
    }
  }

  function updateTitleMotes(dt, time) {
    for (var i = 0; i < titleMotes.length; i++) {
      var mote = titleMotes[i];
      mote.y += mote.vy * dt;
      mote.x += (mote.vx + Math.sin(time * 0.4 + mote.phase) * 3) * dt;
      if (mote.y < -20) {
        mote.y = H + 20;
        mote.x = 160 + Math.random() * (W - 320);
      }
      if (mote.x < 120) mote.x = 120;
      if (mote.x > W - 120) mote.x = W - 120;
    }
  }

  function drawTitleMotes(g) {
    g.save();
    g.globalCompositeOperation = 'screen';
    for (var i = 0; i < titleMotes.length; i++) {
      var mote = titleMotes[i];
      var flicker = 0.65 + Math.sin(visualTime * 1.7 * mote.speed + mote.phase) * 0.35;
      g.globalAlpha = mote.alpha * flicker * 0.7;
      g.drawImage(glowWarm, mote.x - mote.size * 7, mote.y - mote.size * 7, mote.size * 14, mote.size * 14);
      g.globalAlpha = mote.alpha * flicker;
      g.fillStyle = '#ffe4ae';
      g.beginPath();
      g.arc(mote.x, mote.y, mote.size * 0.45, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function renderTitle(time, dt) {
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#040a12';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
    drawFog(ctx, time);

    var braziers = getSelectedMap().braziers;
    for (var i = 0; i < braziers.length; i++) {
      var brazier = {
        id: braziers[i].id,
        name: braziers[i].name,
        x: braziers[i].x,
        y: braziers[i].y,
        lit: false,
        index: i,
        progress: 0,
        pulse: 0
      };
      drawBrazierBase(ctx, brazier, time);
    }

    drawLighthouse(ctx, time);
    drawLighthouseBeamTitle(ctx, time);

    if (fgCanvas) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.drawImage(fgCanvas, 0, 0, W, H);
      ctx.restore();
    }

    drawTitleMotes(ctx);
    drawVignette(ctx, true);

    var titleShade = ctx.createRadialGradient(640, 340, 120, 640, 340, 730);
    titleShade.addColorStop(0, 'rgba(2, 6, 11, 0.1)');
    titleShade.addColorStop(0.7, 'rgba(2, 6, 11, 0.29)');
    titleShade.addColorStop(1, 'rgba(1, 4, 8, 0.58)');
    ctx.fillStyle = titleShade;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ============================================================
     主循环
     ============================================================ */

  function updateApplication(dt) {
    visualTime += dt;
    if (appState === 'title' || appState === 'intro') {
      updateTitleMotes(dt, visualTime);
      updateParticles(dt, 0.3);
    } else if (appState === 'playing') {
      updateParticles(dt, 1);
    } else if (appState === 'ending') {
      updateParticles(dt, 0.4);
    } else if (appState === 'victory' || appState === 'defeat') {
      updateParticles(dt, 0.5);
    }

    if (shake > 0) {
      shake *= Math.exp(-7.5 * dt);
      if (shake < 0.03) shake = 0;
    }

    if (appState === 'ending') {
      endTimer -= dt;
      if (endKind === 'victory') {
        dawnVisual = Math.min(1, dawnVisual + dt * 0.35);
      }
      if (endTimer <= 0) finishEnding();
    } else if (appState === 'victory') {
      dawnVisual = Math.min(1, dawnVisual + dt * 0.4);
      if (shakeEnabled && Math.random() < dt * 1.4) {
        burst(280 + Math.random() * (W - 560), H * 0.55 + Math.random() * 80, 1, 'ember', 5, 12);
      }
    }

    if (gameState && (appState === 'playing' || appState === 'ending')) {
      if (gameState.player.beamActive && appState === 'playing') {
        beamMoteTimer -= dt;
        if (beamMoteTimer <= 0) {
          beamMoteTimer = 0.035;
          var player = gameState.player;
          var angle = Math.atan2(player.aimY, player.aimX);
          var spread = (Math.random() * 2 - 1) * B.BEAM_HALF_ANGLE;
          var distance = 30 + Math.random() * B.BEAM_RANGE * 0.86;
          addParticle('beam-mote', player.x + Math.cos(angle + spread) * distance, player.y + Math.sin(angle + spread) * distance, {
            vx: Math.cos(angle + spread) * 30,
            vy: Math.sin(angle + spread) * 30,
            life: 0.4 + Math.random() * 0.4,
            size: 0.8 + Math.random() * 1.3
          });
        }
      }
      var focusNow = appState === 'playing' && gameState.player.beamActive;
      if (focusNow !== lastFocusState && AUDIO) {
        lastFocusState = focusNow;
        AUDIO.setFocus(focusNow, gameState.phase === 'finale');
      }
    }

    if (appState === 'title' || appState === 'intro' || appState === 'playing' || appState === 'paused' || appState === 'ending') {
      updateHud(false);
    }
  }

  function frame(now) {
    window.requestAnimationFrame(frame);
    var dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;

    if (appState === 'playing' && gameState) {
      accumulator += dt;
      var steps = 0;
      while (accumulator >= STEP && steps < 5 && appState === 'playing') {
        var input = buildInput(true);
        CORE.update(gameState, STEP, input);
        accumulator -= STEP;
        steps++;
        if (gameState.phase === 'victory' || gameState.phase === 'defeat') break;
      }
      if (steps === 5 && accumulator > STEP) accumulator = 0;

      if (gameState.events.length) drainCoreEvents();

      if (gameState.phase === 'victory') {
        beginEnding('victory');
      } else if (gameState.phase === 'defeat') {
        beginEnding('defeat');
      }
    }

    updateApplication(dt);

    if (appState === 'title' || appState === 'intro') {
      renderTitle(visualTime, dt);
    } else {
      renderGame(visualTime, dt);
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  function bindUI() {
    $('startBtn').addEventListener('click', function () { openPrep('short'); });
    UI.expeditionBtn.addEventListener('click', function () { openPrep('expedition'); });
    $('howBtn').addEventListener('click', function () {
      if (AUDIO && !muted) AUDIO.ui();
      openHelp();
    });
    $('introStartBtn').addEventListener('click', beginGame);
    $('introSkipBtn').addEventListener('click', goTitle);

    UI.prepModeShort.addEventListener('click', function () {
      selectedMode = 'short';
      updatePrepUI();
      if (AUDIO && !muted) AUDIO.ui();
    });
    UI.prepModeExpedition.addEventListener('click', function () {
      selectedMode = 'expedition';
      updatePrepUI();
      if (AUDIO && !muted) AUDIO.ui();
    });
    UI.mapChoices.addEventListener('click', function (event) {
      var button = event.target.closest('[data-map]');
      if (!button) return;
      selectedMapId = button.getAttribute('data-map');
      updatePrepUI();
      prepareMapVisuals(selectedMapId);
      if (AUDIO && !muted) AUDIO.ui();
    });
    UI.lighthouseChoices.addEventListener('click', function (event) {
      var button = event.target.closest('[data-type]');
      if (!button) return;
      selectedType = button.getAttribute('data-type');
      updatePrepUI();
      if (AUDIO && !muted) AUDIO.ui();
    });

    $('helpCloseBtn').addEventListener('click', closeHelp);
    $('helpCloseIcon').addEventListener('click', closeHelp);
    $('pauseBtn').addEventListener('click', function () { pauseGame(false); });
    $('resumeBtn').addEventListener('click', resumeGame);
    $('pauseHelpBtn').addEventListener('click', function () {
      if (AUDIO && !muted) AUDIO.ui();
      openHelp();
    });
    $('restartBtn').addEventListener('click', beginGame);
    $('quitBtn').addEventListener('click', goTitle);
    $('retryBtn').addEventListener('click', beginGame);
    $('defeatTitleBtn').addEventListener('click', goTitle);
    $('againBtn').addEventListener('click', beginGame);
    $('victoryTitleBtn').addEventListener('click', goTitle);
    $('shakeBtn').addEventListener('click', toggleShake);
    UI.muteBtn.addEventListener('click', toggleMute);
    UI.titleMuteBtn.addEventListener('click', toggleMute);
    UI.rotateCloseBtn.addEventListener('click', function () {
      rotateHintDismissed = true;
      UI.rotateHint.hidden = true;
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var code = event.code;

      if (code === 'Escape' || code === 'KeyP') {
        if (helpOpen) {
          event.preventDefault();
          closeHelp();
          return;
        }
        if (appState === 'playing') {
          event.preventDefault();
          pauseGame(false);
          return;
        }
        if (appState === 'paused') {
          event.preventDefault();
          resumeGame();
          return;
        }
      }

      if (code === 'KeyM') {
        if (event.repeat) return;
        event.preventDefault();
        toggleMute();
        return;
      }

      if (helpOpen) return;

      if ((appState === 'title' || appState === 'intro') && (code === 'Enter' || code === 'Space')) {
        var target = event.target;
        if (target && target.tagName === 'BUTTON') return;
        event.preventDefault();
        if (appState === 'title') goIntro();
        else beginGame();
        return;
      }

      if (appState !== 'playing') return;

      if (code === 'KeyE') {
        keys.KeyE = true;
        event.preventDefault();
        return;
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (!event.repeat) dashQueued = true;
        event.preventDefault();
        return;
      }
      if (code === 'Space') {
        keys.Space = true;
        event.preventDefault();
        return;
      }
      if (code === 'KeyW' || code === 'ArrowUp') {
        keys.KeyW = true;
        event.preventDefault();
      } else if (code === 'KeyS' || code === 'ArrowDown') {
        keys.KeyS = true;
        event.preventDefault();
      } else if (code === 'KeyA' || code === 'ArrowLeft') {
        keys.KeyA = true;
        event.preventDefault();
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        keys.KeyD = true;
        event.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('keyup', function (event) {
      var code = event.code;
      if (code === 'KeyE') keys.KeyE = false;
      if (code === 'Space') keys.Space = false;
      if (code === 'KeyW' || code === 'ArrowUp') keys.KeyW = false;
      if (code === 'KeyS' || code === 'ArrowDown') keys.KeyS = false;
      if (code === 'KeyA' || code === 'ArrowLeft') keys.KeyA = false;
      if (code === 'KeyD' || code === 'ArrowRight') keys.KeyD = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        /* 单次按键已缓存 */
      }
    });

    window.addEventListener('blur', function () {
      if (appState === 'playing' && !helpOpen) pauseGame(true);
      clearInputs();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (appState === 'playing' && !helpOpen) pauseGame(true);
        if (AUDIO) AUDIO.suspend();
      }
    });
  }

  function bindPointer() {
    window.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      updatePointerFromEvent(event);
    }, { passive: true });

    canvas.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (appState !== 'playing') return;
      event.preventDefault();
      ensureAudio();
      updatePointerFromEvent(event);
      pointer.down = true;
    }, { passive: false });

    canvas.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'touch') return;
      pointer.inside = true;
      updatePointerFromEvent(event);
    });

    window.addEventListener('pointerup', function (event) {
      if (event.pointerType === 'touch') return;
      pointer.down = false;
    });

    canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });

    canvas.addEventListener('pointerleave', function (event) {
      if (event.pointerType === 'touch') return;
      /* 保留最后一次鼠标位置，离开画布时不要突然转向 */
      pointer.inside = false;
    });
  }

  function bindResize() {
    window.addEventListener('resize', function () {
      resizeCanvas();
      if (window.innerWidth >= window.innerHeight) UI.rotateHint.hidden = true;
      if (isTouch && window.innerWidth < window.innerHeight && appState === 'playing' && !rotateHintDismissed) {
        maybeShowRotateHint();
      }
    });
    window.addEventListener('orientationchange', function () {
      window.setTimeout(resizeCanvas, 120);
    });

    var app = document.getElementById('app');
    if (app) {
      app.addEventListener('scroll', resetPageScroll, { passive: true });
    }
    window.addEventListener('scroll', resetPageScroll, { passive: true });
    document.addEventListener('focusin', function () {
      window.setTimeout(resetPageScroll, 0);
    });
  }

  /* ============================================================
     调试接口（仅在 #debug 下暴露，供自动化验收）
     ============================================================ */

  function exposeDebug() {
    if (window.location.hash.indexOf('debug') === -1) return;
    window.__NIGHT_DEBUG__ = {
      getState: function () { return gameState; },
      getScreen: function () { return appState; },
      getTarget: function () { return gameState ? CORE.getInteractTarget(gameState) : null; },
      startGame: function () {
        if (appState === 'title' || appState === 'intro') beginGame();
      },
      teleport: function (x, y) {
        if (!gameState) return;
        gameState.player.x = clamp(x, B.BOUNDS.left, B.BOUNDS.right);
        gameState.player.y = clamp(y, B.BOUNDS.top, B.BOUNDS.bottom);
      },
      setOil: function (value) {
        if (!gameState) return;
        gameState.player.oil = clamp(value, 0, B.OIL_MAX);
      },
      setTime: function (value) {
        if (!gameState) return;
        gameState.timeLeft = Math.max(0, value);
      },
      setHp: function (value) {
        if (!gameState) return;
        gameState.player.hp = clamp(value, 0, gameState.player.maxHp);
      },
      fillBraziers: function () {
        if (!gameState) return;
        for (var i = 0; i < gameState.braziers.length; i++) {
          gameState.braziers[i].lit = true;
          gameState.braziers[i].progress = B.BRAZIER_IGNITE_TIME;
        }
        gameState.braziersLit = 4;
        gameState.flags.allLitAnnounced = true;
      },
      advanceFinale: function (seconds) {
        if (!gameState || gameState.phase !== 'finale') return;
        gameState.finaleTime = Math.min((gameState.finaleDuration || B.FINALE_DURATION) - 0.02, gameState.finaleTime + seconds);
      },
      damagePlayer: function (amount) {
        if (!gameState) return;
        gameState.player.invuln = 0;
        gameState.player.hp = Math.max(0, gameState.player.hp - (amount || 1));
      }
    };
  }

  /* ============================================================
     启动
     ============================================================ */

  resizeCanvas();
  buildHearts();
  prepareMapVisuals(selectedMapId);
  initTitleMotes();
  updateMuteUI();
  updateShakeUI();
  updateBestUI();
  updatePrepUI();
  bindUI();
  bindKeyboard();
  bindPointer();
  bindResize();
  if (isTouch) {
    setupTouchControls();
    UI.introControls.textContent = '左摇杆移动 · 右摇杆瞄准并亮灯 · 点按「点灯」交互 · 「疾步」闪避';
  }
  exposeDebug();
  syncScreens();
  window.requestAnimationFrame(function (now) {
    lastTime = now;
    window.requestAnimationFrame(frame);
  });
})();
