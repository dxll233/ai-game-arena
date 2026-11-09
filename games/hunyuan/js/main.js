/* =========================================================
 * 《回响 / ECHO》 主流程：输入、HUD、关卡流程、存档
 * ========================================================= */
(function (root) {
  'use strict';

  var LEVELS = root.EchoLevels;
  var Engine = root.EchoEngine;
  var R = root.EchoRender;
  var A = root.EchoAudio;

  var canvas = document.getElementById('game');
  var overlay = document.getElementById('overlay');
  var toastEl = document.getElementById('toast');
  var hintEl = document.getElementById('hint');
  var levelTag = document.getElementById('level-tag');
  var els = {
    steps: document.getElementById('stat-steps'),
    par: document.getElementById('stat-par'),
    echoes: document.getElementById('stat-echoes'),
    stars: document.getElementById('stat-stars'),
    next: document.getElementById('stat-next'),
    anchor: document.getElementById('stat-anchor')
  };

  var KEYMAP = {
    ArrowUp: 'U', KeyW: 'U',
    ArrowDown: 'D', KeyS: 'D',
    ArrowLeft: 'L', KeyA: 'L',
    ArrowRight: 'R', KeyD: 'R',
    Space: 'W', Period: 'W', NumpadDecimal: 'W'
  };

  // 存档键与 schema 常量必须在首次 loadProgress() 调用前初始化（var 提升只提升声明不提升赋值）
  var SAVE_KEY = 'echo.progress';
  var SAVE_SCHEMA = 2;

  var _loaded = loadProgress();
  var G = {
    mode: 'menu',      // menu | select | play | dead | won | demo | demoDone
    index: 0,
    state: null,
    undo: [],           // 完整本局撤销栈：不再裁剪（A3）
    demo: { queue: '', i: 0, at: 0, undo: [] },
    demoActive: false, // 演示与正式游玩隔离标记（A1）
    paused: false,     // 暂停（P / 按钮 / 失焦自动）
    settled: false,    // 本局是否已结算，防止重复结算
    held: null,
    nextRepeat: 0,
    progress: (_loaded && _loaded.levels) || {},
    settings: (_loaded && _loaded.settings) || { muted: false },
    saveCorrupt: !!(_loaded && _loaded.corrupt),
    saveMigrated: !!(_loaded && _loaded.migrated),
    prediction: null,  // 时间望远镜预测（V）：任何新动作都会使其过期
    scopeSeen: false,
    nextRepeat: 0,
    toastTimer: 0
  };

  /* ---------------- 存档（第三轮加固：schema + 校验和 + 迁移 + 坏档回退） ----------------
   * schema 2 格式：{ schema:2, checksum, levels:{id:{stars,steps,done}}, settings:{muted} }
   * schema 1（旧档，直接是 levels 映射）在读取时自动迁移，不丢玩家纪录。
   * 解析失败或校验和不符：把原始字符串备份到 echo.progress.corrupt 后从空白开始，
   * 绝不自动清除玩家数据，并通过 G.saveCorrupt 提示。
   */
  function saveChecksum(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function loadProgress() {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; } // 存储不可用 → 本次会话内存态
    if (!raw) return { levels: {}, settings: { muted: false }, corrupt: false };
    try {
      var obj = JSON.parse(raw);
      if (obj && obj.schema === SAVE_SCHEMA) {
        var expect = saveChecksum(JSON.stringify({ levels: obj.levels, settings: obj.settings }));
        if (expect !== obj.checksum) throw new Error('checksum mismatch');
        return { levels: obj.levels || {}, settings: obj.settings || { muted: false }, corrupt: false };
      }
      // 旧档迁移（schema 1：对象本身就是 levels 映射）
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { levels: obj, settings: { muted: false }, corrupt: false, migrated: true };
      }
      throw new Error('unknown shape');
    } catch (e) {
      try { localStorage.setItem(SAVE_KEY + '.corrupt', raw); } catch (e2) {}
      return { levels: {}, settings: { muted: false }, corrupt: true };
    }
  }

  function saveProgress() {
    var payload = {
      schema: SAVE_SCHEMA,
      checksum: saveChecksum(JSON.stringify({ levels: G.progress, settings: G.settings })),
      levels: G.progress,
      settings: G.settings
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); } catch (e) {}
  }
  function saveAvailable() { G._saveOk = (G._saveOk === undefined ? true : G._saveOk); try { localStorage.setItem(SAVE_KEY + '.probe', '1'); localStorage.removeItem(SAVE_KEY + '.probe'); return true; } catch (e) { return false; } }
  function unlocked(i) {
    if (i === 0) return true;
    var prev = LEVELS[i - 1];
    return !!(G.progress[prev.id] && G.progress[prev.id].done);
  }

  /* ---------------- 关卡控制 ---------------- */
  function level() { return LEVELS[G.index]; }

  /** 从关卡数据聚合出真实的节拍规则，杜绝教程硬编码 LEVELS[1].echoEvery（A2） */
  function describeEchoRule() {
    var first = LEVELS[0].echoEvery;
    var restTs = [];
    for (var i = 1; i < LEVELS.length; i++) {
      if (restTs.indexOf(LEVELS[i].echoEvery) < 0) restTs.push(LEVELS[i].echoEvery);
    }
    if (restTs.length === 1 && restTs[0] !== first) {
      return '第 1 关每 ' + first + ' 拍；其余关卡每 ' + restTs[0] + ' 拍';
    }
    var groups = {};
    LEVELS.forEach(function (l) { (groups[l.echoEvery] = groups[l.echoEvery] || []).push(l.id); });
    return Object.keys(groups).map(function (t) {
      var ids = groups[t];
      return (ids.length === 1 ? '第 ' + ids[0] + ' 关' : '第 ' + ids.join('、') + ' 关') + '每 ' + t + ' 拍';
    }).join('；');
  }

  function levelHasAnchor(lv) {
    var st0 = Engine.getStatic(lv);
    for (var y = 0; y < st0.rows; y++) {
      for (var x = 0; x < st0.cols; x++) if (st0.tiles[y][x].anchor) return true;
    }
    return false;
  }

  function startLevel(i) {
    G.index = i;
    G.state = Engine.create(LEVELS[i]);
    G.undo = [];
    G.mode = 'play';
    G.demoActive = false;
    G.paused = false;
    G.settled = false;
    G.prediction = null;
    G.demo = { queue: '', i: 0, at: 0, undo: [] };
    R.clearEffects();
    closeOverlay();
    hintEl.textContent = LEVELS[i].hint || '';
    levelTag.textContent = '第 ' + LEVELS[i].id + ' 关 · ' + LEVELS[i].name;
    // 关卡提示已在底部 #hint 常驻显示；这里只给一条短 toast，
    // 避免长文本浮层盖住棋盘底部（门/压力板正位于这一带）。
    toast('第 ' + LEVELS[i].id + ' 关 · ' + LEVELS[i].name, 1600);
    updateHUD();
  }

  function restart() {
    startLevel(G.index);
    A.play('ui');
  }

  function undo() {
    if (G.mode === 'demo' || G.mode === 'demoDone' || G.paused) return;
    if (!G.undo.length) return;
    G.state = G.undo.pop();
    G.mode = 'play';
    G.settled = false;              // 允许撤销胜利/死亡动作后重新结算
    G.prediction = null;            // 旧预演随状态回滚一并过期
    closeOverlay();
    A.play('wait');
    updateHUD();
  }

  function act(a) {
    if (G.mode !== 'play' || G.paused || !G.state || G.state.status !== 'playing') return;
    // 完整本局撤销：不再按 400 步裁剪快照（A3）。
    // 快照包含 timeline/history/echoes/guards/stars/crystals/anchor/status，
    // 因此撤销可逐字段恢复步数、位置、回响、守卫、星尘、水晶、门与胜负状态。
    G.undo.push(Engine.clone(G.state));
    G.prediction = null;            // 拍推进使旧预演过期
    var res = Engine.applyAction(G.state, a);
    R.consumeEvents(G.state, res.events);
    A.consume(res.events);
    updateHUD();
    if (G.state.status === 'won') onWin();
    else if (G.state.status === 'dead') onDead();
  }

  /* ---------------- 时间望远镜（第三轮核心升级） ----------------
   * V = 预演：语义上等同于「等待一拍」，但显示引擎保证确定的未来：
   * 在场残像的冻结点/被撞碎/被挤出预警、下一只残像的出生点、原地不动的死亡预警。
   * 代价真实：预演推进了一拍，会改变残像的诞生节奏与守卫相位。
   * 预测走 Engine.predict（clone 上模拟），绝不触碰真实状态。
   */
  function scope() {
    if (G.mode !== 'play' || G.paused || !G.state || G.state.status !== 'playing') return;
    G.undo.push(Engine.clone(G.state));
    G.prediction = null;
    var res = Engine.applyAction(G.state, 'W');
    R.consumeEvents(G.state, res.events);
    A.consume(res.events);
    G.prediction = Engine.predict(G.state);
    A.play('scope');
    updateHUD();
    if (!G.scopeSeen) {
      G.scopeSeen = true;
      toast('望远镜已开启：青色准星 = 残像将定格的位置；虚线菱形 = 下一只残像的出生点。预演消耗了一拍。', 5600);
    }
    if (G.state.status === 'won') { G.prediction = null; onWin(); }
    else if (G.state.status === 'dead') { G.prediction = null; onDead(); }
  }

  function updateHUD() {
    var s = G.state;
    if (!s) return;
    els.steps.textContent = s.step;
    els.par.textContent = level().par;
    els.echoes.textContent = s.echoes.length + '/' + s.M;
    var got = s.stars.filter(function (x) { return x.taken; }).length;
    els.stars.textContent = got + '/' + s.stars.length;
    var phase = s.step % s.T;
    els.next.textContent = (phase === 0 ? s.T : s.T - phase);
    if (els.anchor) {
      if (!levelHasAnchor(level())) els.anchor.textContent = '—';
      else if (s.anchor) els.anchor.textContent = '第' + s.anchor.step + '拍 @' + s.anchor.x + ',' + s.anchor.y;
      else els.anchor.textContent = '未记录';
    }
  }

  /* ---------------- 结算 ---------------- */
  function starCount() {
    var s = G.state;
    var n = 0;
    if (s.status === 'won') n++;
    if (s.stars.length === 0 || s.stars.every(function (x) { return x.taken; })) n++;
    if (s.step <= level().par) n++;
    return n;
  }

  function onWin() {
    // A1：参考解演示绝不能进入正式结算；settled 防止重复结算写坏最佳纪录
    if (G.demoActive || G.mode === 'demo' || G.mode === 'demoDone' || G.settled) return;
    G.settled = true;
    G.mode = 'won';
    var n = starCount();
    var id = level().id;
    var old = G.progress[id] || { stars: 0, steps: Infinity, done: false };
    G.progress[id] = {
      stars: Math.max(old.stars, n),
      steps: Math.min(old.steps === null ? Infinity : old.steps, G.state.step),
      done: true
    };
    saveProgress();
    setTimeout(function () { showWin(n); }, 620);
  }

  function onDead() {
    if (G.demoActive || G.mode === 'demo' || G.mode === 'demoDone' || G.settled) return;
    G.settled = true;
    G.mode = 'dead';
    setTimeout(function () { showDead(); }, 520);
  }

  /* ---------------- 面板 ---------------- */
  function closeOverlay() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }
  function openOverlay(html) {
    overlay.innerHTML = html;
    overlay.classList.remove('hidden');
    overlay.scrollTop = 0;
    // 面板出现时收起 toast，避免提示条浮在结算/暂停按钮上方造成遮挡
    toastEl.classList.add('hidden');
    clearTimeout(G.toastTimer);
  }

  function showTitle() {
    G.mode = 'menu';
    G.state = Engine.create(LEVELS[0]);
    updateHUD();
    openOverlay(
      '<div class="panel">' +
      '<div class="eyebrow">格子 · 时间 · 解谜</div>' +
      '<h1>回响<span>ECHO</span></h1>' +
      '<p class="lead">你无法同时出现在两个地方 —— <b>但过去的你可以</b>。</p>' +
      '<div class="rules">' +
      '每走一步，时间就前进一拍；你的每一步都会被记录。<br>' +
      '按关卡各自的节拍（<b>' + describeEchoRule() + '</b>，以 HUD「拍后下个残像」倒计时为准），' +
      '一个<b>残像</b>会从几拍前的位置诞生，' +
      '把你刚才走过的路重演一遍，最后<b>定格在触发那一刻你所站的位置</b>。<br>' +
      '用残像去压住踏板、骗过守卫；第 8 关起可用<b>时间锚</b>改写残像的出生点。<br>' +
      '第 13 关起可用<b>时间望远镜</b>（<span class="k">V</span>，消耗一拍）预览残像将定格的位置。<br>' +
      '<b>移动</b> <span class="k">↑</span><span class="k">↓</span><span class="k">←</span><span class="k">→</span> / WASD &nbsp;·&nbsp; ' +
      '<b>等待</b> <span class="k">空格</span> &nbsp;·&nbsp; ' +
      '<b>预演</b> <span class="k">V</span> &nbsp;·&nbsp; ' +
      '<b>撤销</b> <span class="k">Z</span> &nbsp;·&nbsp; <b>重来</b> <span class="k">R</span> &nbsp;·&nbsp; ' +
      '<b>暂停</b> <span class="k">P</span> &nbsp;·&nbsp; <b>演示</b> <span class="k">H</span>（不写入纪录）' +
      '</div>' +
      '<div class="panel-actions">' +
      '<button class="primary" id="p-start">开始游戏</button>' +
      '<button id="p-select">选择关卡</button>' +
      '</div></div>'
    );
    document.getElementById('p-start').onclick = function () {
      A.play('ui');
      var firstUnfinished = 0;
      for (var i = 0; i < LEVELS.length; i++) {
        if (!(G.progress[LEVELS[i].id] && G.progress[LEVELS[i].id].done)) { firstUnfinished = i; break; }
        firstUnfinished = Math.min(i + 1, LEVELS.length - 1);
      }
      startLevel(unlocked(firstUnfinished) ? firstUnfinished : 0);
    };
    document.getElementById('p-select').onclick = function () { A.play('ui'); showSelect(); };
  }

  function showSelect() {
    G.mode = 'select';
    var cards = LEVELS.map(function (lv, i) {
      var ok = unlocked(i);
      var rec = G.progress[lv.id];
      var sc = rec ? '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars) : '☆☆☆';
      return '<button class="level-card' + (ok ? '' : ' locked') + (i === G.index ? ' current' : '') + '" data-i="' + i + '">' +
        '<span class="no">' + (ok ? '第 ' + lv.id + ' 关' : '未解锁') + '</span>' +
        '<span class="nm">' + lv.name + '</span>' +
        '<span class="sc">' + (ok ? sc : '　　　') + '</span>' +
        '</button>';
    }).join('');
    openOverlay(
      '<div class="panel">' +
      '<div class="eyebrow">关卡</div><h2>选择关卡</h2>' +
      '<div class="level-grid">' + cards + '</div>' +
      '<div class="panel-actions"><button id="p-back">返回</button></div>' +
      '</div>'
    );
    [].forEach.call(overlay.querySelectorAll('.level-card'), function (btn) {
      btn.onclick = function () {
        var i = parseInt(btn.getAttribute('data-i'), 10);
        if (!unlocked(i)) { A.play('locked'); toast('先通过上一关吧'); return; }
        A.play('ui');
        startLevel(i);
      };
    });
    document.getElementById('p-back').onclick = function () { A.play('ui'); showTitle(); };
  }

  function showWin(n) {
    var lv = level();
    var last = G.index >= LEVELS.length - 1;
    var got = G.state.stars.filter(function (x) { return x.taken; }).length;
    openOverlay(
      '<div class="panel">' +
      '<div class="eyebrow">第 ' + lv.id + ' 关 · ' + lv.name + '</div>' +
      '<h2>' + (last ? '全部关卡完成' : '通关') + '</h2>' +
      '<div class="stars">' +
      [0, 1, 2].map(function (i) {
        return '<div class="star-badge' + (i < n ? ' on' : '') + '">★</div>';
      }).join('') +
      '</div>' +
      '<div class="result-line">用了 <b>' + G.state.step + '</b> 步 · 目标 ' + lv.par + ' 步 · 星尘 <b>' + got + '/' + G.state.stars.length + '</b></div>' +
      '<div class="panel-actions">' +
      (last ? '' : '<button class="primary" id="p-next">进入第 ' + LEVELS[G.index + 1].id + ' 关</button>') +
      '<button id="p-again">再来一次</button>' +
      '<button id="p-select2">关卡列表</button>' +
      '</div></div>'
    );
    var next = document.getElementById('p-next');
    if (next) next.onclick = function () { A.play('ui'); startLevel(G.index + 1); };
    document.getElementById('p-again').onclick = function () { A.play('ui'); restart(); };
    document.getElementById('p-select2').onclick = function () { A.play('ui'); showSelect(); };
  }

  function showDead() {
    var why = G.state.deathCause === 'guard' ? '你被守卫抓住了' : '你踏进了尖刺';
    openOverlay(
      '<div class="panel">' +
      '<div class="eyebrow">时间回溯</div>' +
      '<h2>' + why + '</h2>' +
      '<p class="lead">没关系 —— 时间是可以回退的。</p>' +
      '<div class="panel-actions">' +
      '<button class="primary" id="p-back">退回一步</button>' +
      '<button id="p-restart">从头再来</button>' +
      '</div></div>'
    );
    document.getElementById('p-back').onclick = function () { A.play('ui'); undo(); };
    document.getElementById('p-restart').onclick = function () { A.play('ui'); restart(); };
  }

  /* ---------------- 暂停（P / 顶栏按钮 / 失焦自动） ---------------- */
  function togglePause(reason) {
    if (G.mode !== 'play' && G.mode !== 'demo') return;
    G.paused = !G.paused;
    heldSet = {}; lastHeld = null;
    if (G.paused) {
      openOverlay(
        '<div class="panel">' +
        '<div class="eyebrow">ECHO · ' + level().name + '</div>' +
        '<h2>已暂停</h2>' +
        '<p class="lead">' + (reason || '时间已停住。按 P 或点「继续」恢复。') + '</p>' +
        '<div class="panel-actions">' +
        '<button class="primary" id="p-resume">继续</button>' +
        '<button id="p-levels-pause">关卡列表</button>' +
        '</div></div>'
      );
      document.getElementById('p-resume').onclick = function () { A.play('ui'); togglePause(); };
      document.getElementById('p-levels-pause').onclick = function () { A.play('ui'); showSelect(); };
    } else {
      closeOverlay();
    }
    A.play('ui');
  }

  function autoPause(reason) {
    if ((G.mode === 'play' || G.mode === 'demo') && !G.paused) togglePause(reason);
  }

  /* ---------------- 参考解演示（与正式存档完全隔离，A1 / B3） ---------------- */
  function startDemo() {
    var sol = level().solution;
    if (!sol) { toast('这一关还没有内置参考解'); return; }
    A.play('ui');
    startLevel(G.index);              // 回到本关正式初态，并清空正式撤销栈
    G.mode = 'demo';
    G.demoActive = true;
    G.settled = false;
    G.demo = { queue: sol, i: 0, at: performance.now() + 500, undo: [] };
    toast('参考解演示中：共 ' + sol.length + ' 步（不写入纪录，按任意键可中断）', 3000);
  }

  /** 演示被玩家打断：回到本关正式初态，不写任何存档 */
  function interruptDemo() {
    if (!G.demoActive) return;
    G.demoActive = false;
    startLevel(G.index);
    toast('参考解演示已中断，已回到本关起点', 2200);
  }

  function finishDemo(result) {
    if (!G.demoActive) return;
    G.demoActive = false;
    G.mode = 'demoDone';
    heldSet = {}; lastHeld = null;
    setTimeout(function () {
      if (G.mode === 'demoDone') showDemoEnd(result);
    }, 420);
  }

  function showDemoEnd(result) {
    var ok = result === 'won';
    var desc = ok ? '演示已按内置参考解抵达出口。'
      : (result === 'dead' ? '演示在中途阵亡，请检查关卡数据。' : '演示序列已播放完毕，但未判定胜利。');
    openOverlay(
      '<div class="panel">' +
      '<div class="eyebrow">参考解 · 自动演示</div>' +
      '<h2>演示完成' + (ok ? ' · 已到达出口' : '') + '</h2>' +
      '<p class="lead">' + desc + '</p>' +
      '<div class="rules">本次为自动演示：<b>不会</b>写入正式星级、最佳步数或关卡解锁；' +
      '手动通关才会记录。退出演示后从本关起点重新开始。<br>' +
      '演示与中断都不会污染正式纪录，撤销栈也保持干净。</div>' +
      '<div class="panel-actions">' +
      '<button class="primary" id="p-demo-exit">退出演示</button>' +
      '<button id="p-demo-replay">重播</button>' +
      '<button id="p-demo-levels">关卡列表</button>' +
      '</div></div>'
    );
    document.getElementById('p-demo-exit').onclick = function () { A.play('ui'); startLevel(G.index); };
    document.getElementById('p-demo-replay').onclick = function () { A.play('ui'); startDemo(); };
    document.getElementById('p-demo-levels').onclick = function () { A.play('ui'); showSelect(); };
  }

  function tickDemo(now) {
    if (G.mode !== 'demo') return;
    if (G.paused) { G.demo.at = now + 16.7; return; }
    if (now < G.demo.at) return;
    if (G.demo.i >= G.demo.queue.length) { finishDemo('incomplete'); return; }
    var a = G.demo.queue[G.demo.i++];
    G.demo.undo.push(Engine.clone(G.state));   // 演示自己的撤销栈，不混入正式 G.undo
    var res = Engine.applyAction(G.state, a);
    R.consumeEvents(G.state, res.events);
    A.consume(res.events);
    updateHUD();
    G.demo.at = now + 150;
    // 不调用 onWin / onDead：演示永不写正式存档
    if (G.state.status === 'won') finishDemo('won');
    else if (G.state.status === 'dead') finishDemo('dead');
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(G.toastTimer);
    G.toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 3200);
  }

  /* ---------------- 输入 ---------------- */
  var heldSet = {};
  var lastHeld = null;

  function keyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var code = e.code || '';
    if (KEYMAP[code] || code === 'Space') e.preventDefault();

    if (G.paused && code !== 'KeyP' && code !== 'Escape') return;
    if (G.mode === 'demoDone') {
      if (code === 'Escape') showSelect();
      else if (code === 'KeyR') restart();
      else if (code === 'KeyH') startDemo();
      return;
    }
    // 演示中任意非暂停键都视为「玩家接管」：中断并回到正式初态
    if (G.mode === 'demo' && code !== 'KeyP') interruptDemo();

    if (code === 'KeyP') { togglePause(); return; }
    if (code === 'KeyZ' || code === 'Backspace') { undo(); return; }
    if (code === 'KeyR') { restart(); return; }
    if (code === 'KeyH') { startDemo(); return; }
    if (code === 'KeyV') { scope(); return; }
    if (code === 'Escape') { showSelect(); return; }

    var a = KEYMAP[code];
    if (!a) return;
    if (heldSet[code]) return;
    heldSet[code] = true;
    lastHeld = a;
    G.nextRepeat = performance.now() + 250;
    act(a);
  }

  function keyUp(e) {
    var code = e.code || '';
    delete heldSet[code];
    var still = Object.keys(heldSet).filter(function (k) { return KEYMAP[k]; });
    lastHeld = still.length ? KEYMAP[still[still.length - 1]] : null;
  }

  function tickRepeat(now) {
    if (!lastHeld || G.mode !== 'play' || G.paused) return;
    if (now < G.nextRepeat) return;
    act(lastHeld);
    G.nextRepeat = now + 110;
  }

  document.addEventListener('keydown', keyDown);
  document.addEventListener('keyup', keyUp);
  function clearHeldAndPause(reason) {
    heldSet = {}; lastHeld = null;
    autoPause(reason);
  }
  root.addEventListener('blur', function () {
    clearHeldAndPause('窗口失焦，已自动暂停；按 P 或点「继续」恢复。');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearHeldAndPause('页面切到后台，已自动暂停；按 P 或点「继续」恢复。');
  });

  /* 触屏 / 鼠标按钮 */
  [].forEach.call(document.querySelectorAll('.pad-btn'), function (btn) {
    var timer = null;
    function down(e) {
      e.preventDefault();
      var a = btn.getAttribute('data-act');
      act(a);
      G.nextRepeat = performance.now() + 250;
      timer = setInterval(function () { act(a); }, 130);
    }
    function up() { clearInterval(timer); timer = null; }
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });

  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-restart').onclick = restart;
  var btnScope = document.getElementById('btn-scope');
  if (btnScope) btnScope.onclick = scope;
  document.getElementById('btn-levels').onclick = function () { A.play('ui'); showSelect(); };
  document.getElementById('btn-pause').onclick = function () { A.play('ui'); togglePause(); };
  document.getElementById('btn-demo').onclick = startDemo;
  var btnSound = document.getElementById('btn-sound');
  btnSound.onclick = function () {
    var m = A.toggle();
    this.textContent = m ? '♪̸' : '♪';
    G.settings.muted = m;
    saveProgress();
    if (!m) A.play('ui');
  };
  // 启动时恢复静音设置与坏档提示
  A.setMuted(!!G.settings.muted);
  btnSound.textContent = G.settings.muted ? '♪̸' : '♪';
  if (G.saveCorrupt) {
    setTimeout(function () {
      toast('检测到存档损坏：坏档已备份（echo.progress.corrupt），已从空白进度开始', 6400);
    }, 600);
  }

  /* ---------------- 主循环 ---------------- */
  R.init(canvas);
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    tickRepeat(now);
    tickDemo(now);
    if (G.state) R.draw(G.state, dt, (G.mode === 'play' && !G.paused) ? G.prediction : null);
    requestAnimationFrame(frame);
  }

  /* 启动 */
  showTitle();
  requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);
