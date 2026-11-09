/* =========================================================
 * 《回响 / ECHO》 确定性回合引擎
 * 纯逻辑：不引用任何 DOM / Canvas API，可被 Node 直接 require
 * ========================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EchoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = {
    U: { dx: 0, dy: -1 },
    D: { dx: 0, dy: 1 },
    L: { dx: -1, dy: 0 },
    R: { dx: 1, dy: 0 },
    W: { dx: 0, dy: 0 }
  };
  var OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
  var GUARD_CHAR = { '\u2191': 'U', '\u2193': 'D', '\u2190': 'L', '\u2192': 'R' };
  var CHANNELS = ['a', 'b', 'c', 'd'];

  /* ---------- 静态地图解析（带缓存） ---------- */
  var staticCache = new WeakMap();

  function buildStatic(def) {
    var rows = def.map.length;
    var cols = def.map[0].length;
    var tiles = [];
    var plates = { a: [], b: [], c: [], d: [] };
    var doors = { A: [], B: [], C: [], D: [] };
    var start = null, exitCell = null, guardStart = [];

    for (var y = 0; y < rows; y++) {
      var line = def.map[y];
      if (line.length !== cols) {
        throw new Error('关卡 ' + def.name + ' 第 ' + y + ' 行长度不一致：' + line.length + ' != ' + cols);
      }
      var row = [];
      for (var x = 0; x < cols; x++) {
        var ch = line[x];
        var t = {
          wall: false, plate: null, door: null, exit: false, start: false,
          star: false, spike: false, crystal: false, anchor: false, ch: ch
        };
        if (ch === '#') t.wall = true;
        else if (ch === 'S') { t.start = true; start = { x: x, y: y }; }
        else if (ch === 'E') { t.exit = true; exitCell = { x: x, y: y }; }
        else if (ch === '*') t.star = true;
        else if (ch === 'x') t.spike = true;
        else if (ch === 'o') t.crystal = true;
        else if (ch === '^') t.anchor = true;          // 时间锚（第二轮新增机关）
        else if (ch === '!') {                         // 尖刺压力板（通道 a）：玩家致命、回响可站
          t.spike = true; t.plate = 'a'; plates.a.push({ x: x, y: y });
        }
        else if (CHANNELS.indexOf(ch) >= 0) { t.plate = ch; plates[ch].push({ x: x, y: y }); }
        else if ('ABCD'.indexOf(ch) >= 0) { t.door = ch; doors[ch].push({ x: x, y: y }); }
        else if (GUARD_CHAR[ch]) { guardStart.push({ x: x, y: y, dir: GUARD_CHAR[ch] }); }
        else if (ch !== '.') {
          throw new Error('未知地图字符 "' + ch + '" 位于关卡 ' + def.name + ' (' + x + ',' + y + ')');
        }
        row.push(t);
      }
      tiles.push(row);
    }

    if (!start) throw new Error('关卡 ' + def.name + ' 缺少起点 S');
    if (!exitCell) throw new Error('关卡 ' + def.name + ' 缺少出口 E');

    CHANNELS.forEach(function (ch) {
      var up = ch.toUpperCase();
      if (doors[up].length && !plates[ch].length) {
        throw new Error('关卡 ' + def.name + ' 的门 ' + up + ' 没有对应的压力板 ' + ch);
      }
    });

    return { cols: cols, rows: rows, tiles: tiles, start: start, exit: exitCell, plates: plates, doors: doors, guardStart: guardStart };
  }

  function getStatic(def) {
    var s = staticCache.get(def);
    if (!s) { s = buildStatic(def); staticCache.set(def, s); }
    return s;
  }

  /* ---------- 建立运行时状态 ---------- */
  function create(def) {
    var st0 = getStatic(def);
    var state = {
      def: def,
      levelId: def.id,
      name: def.name,
      cols: st0.cols,
      rows: st0.rows,
      T: def.echoEvery,
      M: def.maxEchoes,
      par: def.par,
      hint: def.hint || '',
      step: 0,
      timeline: [],
      history: [{ x: st0.start.x, y: st0.start.y }],
      player: { x: st0.start.x, y: st0.start.y },
      echoes: [],
      guards: st0.guardStart.map(function (g) { return { x: g.x, y: g.y, dir: g.dir }; }),
      stars: [],
      crystals: [],
      anchor: null,           // 时间锚记录：{ x, y, step } 或 null
      status: 'playing',
      deathCause: null,
      events: []
    };
    for (var y = 0; y < st0.rows; y++) {
      for (var x = 0; x < st0.cols; x++) {
        var t = st0.tiles[y][x];
        if (t.star) state.stars.push({ x: x, y: y, taken: false });
        if (t.crystal) state.crystals.push({ x: x, y: y, taken: false });
      }
    }
    return state;
  }

  function clone(state) {
    var c = {};
    for (var k in state) {
      if (k === 'def') { c.def = state.def; continue; }
      c[k] = JSON.parse(JSON.stringify(state[k]));
    }
    return c;
  }

  /* ---------- 查询 ---------- */
  function tileAt(state, x, y) {
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return null;
    return getStatic(state.def).tiles[y][x];
  }

  function evaluateDoors(state) {
    var st0 = getStatic(state.def);
    var open = {};
    CHANNELS.forEach(function (ch) {
      var list = st0.plates[ch];
      if (!list.length) { open[ch.toUpperCase()] = false; return; }
      var all = true;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var occupied = (state.player.x === p.x && state.player.y === p.y);
        if (!occupied) {
          occupied = state.echoes.some(function (e) { return e.x === p.x && e.y === p.y; });
        }
        if (!occupied) { all = false; break; }
      }
      open[ch.toUpperCase()] = all;
    });
    return open;
  }

  function blocked(state, x, y, open) {
    var t = tileAt(state, x, y);
    if (!t) return true;
    if (t.wall) return true;
    if (t.door && !open[t.door]) return true;
    return false;
  }

  function remaining_same(state) { return state.stars.filter(function (s) { return !s.taken; }).length; }

  /* ---------- 单拍推进 ---------- */
  function applyAction(state, action) {
    if (state.status !== 'playing') return { changed: false, events: [] };
    if (!DIRS[action]) throw new Error('非法动作: ' + action);

    var events = [];
    state.events = events;

    // --- 记录时间线 ---
    state.timeline.push(action);
    state.step++;

    // --- ① 拍初快照：本拍内门状态不变，保证确定性 ---
    var open = evaluateDoors(state);

    // --- ② 回响推进（按诞生顺序） ---
    var dir, nx, ny;
    for (var i = 0; i < state.echoes.length; i++) {
      var e = state.echoes[i];
      if (e.done) continue;
      var a = e.seq[e.i];
      e.i++;
      dir = DIRS[a];
      nx = e.x + dir.dx; ny = e.y + dir.dy;
      if (!blocked(state, nx, ny, open)) { e.x = nx; e.y = ny; events.push({ type: 'echoMove', id: e.id }); }
      if (e.i >= e.seq.length) {
        e.done = true;
        events.push({ type: 'echoFroze', x: e.x, y: e.y, id: e.id });
      }
    }

    // --- ③ 玩家移动 ---
    dir = DIRS[action];
    nx = state.player.x + dir.dx;
    ny = state.player.y + dir.dy;
    if (!blocked(state, nx, ny, open)) {
      state.player.x = nx;
      state.player.y = ny;
      events.push({ type: 'playerMove' });
    } else {
      events.push({ type: 'playerBlocked' });
    }

    var pt = tileAt(state, state.player.x, state.player.y);
    if (pt && pt.spike) {
      state.status = 'dead';
      state.deathCause = 'spike';
      state.history.push({ x: state.player.x, y: state.player.y });
      events.push({ type: 'die', cause: 'spike' });
      return { changed: true, events: events };
    }
    if (pt && pt.crystal) {
      var ci = state.crystals.findIndex(function (c) { return c.x === state.player.x && c.y === state.player.y && !c.taken; });
      if (ci >= 0) {
        state.crystals[ci].taken = true;
        events.push({ type: 'crystal', x: state.player.x, y: state.player.y });
        for (var k = 0; k < state.echoes.length; k++) {
          events.push({ type: 'echoPurged', x: state.echoes[k].x, y: state.echoes[k].y, id: state.echoes[k].id });
        }
        state.echoes = [];
      }
    }
    if (pt && pt.star) {
      var si = state.stars.findIndex(function (s) { return s.x === state.player.x && s.y === state.player.y && !s.taken; });
      if (si >= 0) {
        state.stars[si].taken = true;
        events.push({ type: 'star', x: state.player.x, y: state.player.y });
      }
    }

    // 时间锚：踩上（含原地等待）即以「当前位置 + 当前拍数」覆盖记录。
    // 不暂停时间、不复制星尘/水晶状态；anchor 随 clone 一起回滚。
    if (pt && pt.anchor) {
      state.anchor = { x: state.player.x, y: state.player.y, step: state.step };
      events.push({ type: 'anchorSet', x: state.player.x, y: state.player.y, step: state.step });
    }

    // 玩家撞进守卫身上
    var caught = state.guards.some(function (g) { return g.x === state.player.x && g.y === state.player.y; });
    if (caught) {
      state.status = 'dead';
      state.deathCause = 'guard';
      state.history.push({ x: state.player.x, y: state.player.y });
      events.push({ type: 'die', cause: 'guard' });
      return { changed: true, events: events };
    }

    // --- ④ 守卫移动 ---
    for (var gi = 0; gi < state.guards.length; gi++) {
      var g = state.guards[gi];
      var gd = DIRS[g.dir];
      var tx = g.x + gd.dx, ty = g.y + gd.dy;
      var hitWall = blocked(state, tx, ty, open);
      var hitGuard = state.guards.some(function (o) { return o !== g && o.x === tx && o.y === ty; });
      if (hitWall || hitGuard) {
        g.dir = OPP[g.dir];
        continue;
      }
      // 守卫撞上回响：残像碎裂，守卫被迷惑 —— 原地停顿一拍并掉头
      var shattered = false;
      for (var ei = state.echoes.length - 1; ei >= 0; ei--) {
        if (state.echoes[ei].x === tx && state.echoes[ei].y === ty) {
          events.push({ type: 'echoShatter', x: tx, y: ty, id: state.echoes[ei].id });
          state.echoes.splice(ei, 1);
          shattered = true;
        }
      }
      if (shattered) {
        g.dir = OPP[g.dir];
        events.push({ type: 'guardStunned', x: g.x, y: g.y });
        continue;
      }
      g.x = tx; g.y = ty;
      if (g.x === state.player.x && g.y === state.player.y) {
        state.status = 'dead';
        state.deathCause = 'guard';
        state.history.push({ x: state.player.x, y: state.player.y });
        events.push({ type: 'die', cause: 'guard' });
        return { changed: true, events: events };
      }
    }

    // --- ⑤ 记录玩家本拍末位置（回响生成依赖它） ---
    state.history.push({ x: state.player.x, y: state.player.y });

    // --- ⑥ 回响诞生 ---
    if (state.step > 0 && state.step % state.T === 0) {
      var from = state.history[state.step - state.T];
      if (from) {
        var seq = state.timeline.slice(state.step - state.T, state.step);
        var bornId = 'e' + state.step;
        var born = {
          id: bornId,
          x: from.x, y: from.y,
          seq: seq, i: 0,
          bornStep: state.step,
          done: false,
          fromAnchor: false
        };
        state.echoes.push(born);
        events.push({ type: 'echoBorn', x: born.x, y: born.y, id: bornId });

        /* ---- 时间锚生效 ----
         * 只作用于「本拍新建」且创建序号最小的那只回响（本拍只新建一只）。
         * 没有新回响的拍不进入本分支，天然不触发。
         * 记录点必须合法可通行（非墙、非关闭的门），且未被玩家/守卫/其它回响占据；
         * 不满足则保留该回响原起点，绝不随机改选另一只或移动格上实体。
         * 全部由 state + 关卡数据确定性表达，参考解可重播。
         */
        if (state.anchor && state.anchor.step < state.step) {
          var a = state.anchor;
          var legal = !blocked(state, a.x, a.y, open);
          var occupied =
            (state.player.x === a.x && state.player.y === a.y) ||
            state.guards.some(function (g) { return g.x === a.x && g.y === a.y; }) ||
            state.echoes.some(function (e) { return e !== born && e.x === a.x && e.y === a.y; });
          if (legal && !occupied) {
            born.x = a.x; born.y = a.y; born.fromAnchor = true;
            events.push({ type: 'anchorApplied', x: a.x, y: a.y, id: bornId, anchorStep: a.step });
          } else {
            events.push({ type: 'anchorIgnored', x: a.x, y: a.y, id: bornId,
              reason: legal ? 'occupied' : 'blocked' });
          }
        }

        while (state.echoes.length > state.M) {
          var gone = state.echoes.shift();
          events.push({ type: 'echoExpired', x: gone.x, y: gone.y, id: gone.id });
        }
      }
    }

    // --- ⑦ 胜负：出口需要集齐本关全部时间水晶 ---
    var et = tileAt(state, state.player.x, state.player.y);
    var unlocked = state.crystals.every(function (c) { return c.taken; });
    if (et && et.exit && unlocked) {
      state.status = 'won';
      events.push({ type: 'win' });
    } else if (et && et.exit && !unlocked) {
      events.push({ type: 'exitLocked' });
    }

    return { changed: true, events: events };
  }

  /* ---------- 时间望远镜：确定性预测（不改真实状态） ----------
   * 语义：假设玩家此后一直原地等待，对 clone 逐拍模拟。
   * 可精确预测（与玩家后续走法无关）：
   *   ① 每只在场（未定格）回响的冻结格 / 被守卫撞碎 / 因超限被挤出；
   * ② 下一只回响的诞生格（含时间锚改写结果）与已录步数；
   * ③ 若原地不动，玩家会在第几拍因何种原因死亡。
   * 不可预测的不编造：下一只回响的冻结位置取决于玩家接下来的走法，不输出。
   */
  function predict(state) {
    var T = state.T;
    var horizon = T * 2 + 8;   // 足以覆盖：所有在场回响完结 + 下一只诞生
    var sim = clone(state);
    sim.events = [];

    var futures = [];
    var index = {};
    state.echoes.forEach(function (e) {
      if (e.done) return;
      var f = { id: e.id, freeze: null, shattered: false, expired: false };
      index[e.id] = f;
      futures.push(f);
    });
    var resolved = 0, total = futures.length;

    var nextSpawnStep = (Math.floor(state.step / T) + 1) * T;
    var out = {
      horizon: horizon,
      echoFutures: futures,
      nextEcho: null,          // { atStep, from:{x,y}, fromAnchor, recorded }
      danger: null             // { beat, cause } —— 原地不动会在第几拍死亡
    };

    for (var b = 1; b <= horizon; b++) {
      var res = applyAction(sim, 'W');
      var evs = res.events;
      for (var i = 0; i < evs.length; i++) {
        var ev = evs[i];
        if (ev.type === 'echoFroze' && index[ev.id]) {
          index[ev.id].freeze = { x: ev.x, y: ev.y }; resolved++;
        } else if (ev.type === 'echoShatter' && index[ev.id]) {
          index[ev.id].shattered = true; resolved++;
        } else if (ev.type === 'echoExpired' && index[ev.id]) {
          index[ev.id].expired = true; resolved++;
        } else if (ev.type === 'die' && !out.danger) {
          out.danger = { beat: b, cause: ev.cause };
        } else if (ev.type === 'echoBorn' && state.step + b === nextSpawnStep) {
          var born = null;
          for (var k = 0; k < sim.echoes.length; k++) {
            if (sim.echoes[k].id === ev.id) { born = sim.echoes[k]; break; }
          }
          out.nextEcho = {
            atStep: state.step + b,
            from: { x: ev.x, y: ev.y },
            fromAnchor: !!(born && born.fromAnchor),
            recorded: born ? born.seq.length : 0
          };
        } else if (ev.type === 'anchorApplied' && out.nextEcho && out.nextEcho.atStep === state.step + b) {
          out.nextEcho.from = { x: ev.x, y: ev.y };
          out.nextEcho.fromAnchor = true;
        } else if (ev.type === 'anchorIgnored' && out.nextEcho && out.nextEcho.atStep === state.step + b) {
          out.nextEcho.anchorIgnored = ev.reason;   // 'occupied' | 'blocked'
        }
      }
      if (sim.status !== 'playing') break;
      if (resolved >= total && out.nextEcho) break;
    }
    return out;
  }

  /* ---------- 调试用 ASCII 输出 ---------- */
  function ascii(state) {
    var st0 = getStatic(state.def);
    var lines = [];
    for (var y = 0; y < st0.rows; y++) {
      var s = '';
      for (var x = 0; x < st0.cols; x++) {
        var t = st0.tiles[y][x];
        var cell = t.ch;
        if (t.start) cell = 'S';
        if (t.exit) cell = 'E';
        var isGuard = state.guards.some(function (g) { return g.x === x && g.y === y; });
        var echoIdx = state.echoes.findIndex(function (e) { return e.x === x && e.y === y; });
        if (state.player.x === x && state.player.y === y) cell = '@';
        else if (isGuard) cell = 'G';
        else if (echoIdx >= 0) cell = state.echoes[echoIdx].done ? String.fromCharCode(48 + echoIdx) : ('(' + String.fromCharCode(48 + echoIdx) + ')').charAt(1);
        else if (t.star && !state.stars.some(function (st) { return st.x === x && st.y === y && st.taken; })) cell = '*';
        else if (t.crystal && !state.crystals.some(function (c) { return c.x === x && c.y === y && c.taken; })) cell = 'o';
        else if (t.anchor) cell = '^';
        else if (t.door) cell = evaluateDoors(state)[t.door] ? '_' : t.door;
        else if (t.plate && t.spike) cell = '!';
        else if (t.spike) cell = 'x';
        else if (t.plate) cell = t.plate;
        else if (t.wall) cell = '#';
        else cell = '.';
        s += cell;
      }
      lines.push(s);
    }
    return lines.join('\n');
  }

  return {
    DIRS: DIRS,
    create: create,
    clone: clone,
    applyAction: applyAction,
    evaluateDoors: evaluateDoors,
    tileAt: tileAt,
    getStatic: getStatic,
    ascii: ascii,
    starsLeft: remaining_same,
    predict: predict
  };
});
