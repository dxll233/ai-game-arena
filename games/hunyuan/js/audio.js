(function (root) {
  'use strict';

  var ctx = null;
  var muted = false;

  function ensure() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  function tone(opt) {
    var c = ensure();
    if (!c || muted) return;
    var t0 = c.currentTime + (opt.delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + opt.dur);
    var vol = (opt.gain === undefined ? 0.12 : opt.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + opt.dur + 0.02);
  }

  function noise(dur, gain) {
    var c = ensure();
    if (!c || muted) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    var g = c.createGain();
    g.gain.value = gain || 0.06;
    src.buffer = buf;
    src.connect(g);
    g.connect(c.destination);
    src.start();
  }

  var SOUNDS = {
    move: function () { tone({ freq: 420, to: 520, dur: 0.07, type: 'square', gain: 0.045 }); },
    wait: function () { tone({ freq: 260, dur: 0.06, type: 'sine', gain: 0.035 }); },
    blocked: function () { noise(0.08, 0.045); },
    star: function () {
      [660, 880, 1180].forEach(function (f, i) {
        tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.09, delay: i * 0.06 });
      });
    },
    crystal: function () {
      [520, 700, 940, 1250].forEach(function (f, i) {
        tone({ freq: f, dur: 0.28, type: 'sine', gain: 0.075, delay: i * 0.05 });
      });
    },
    echoBorn: function () { tone({ freq: 180, to: 420, dur: 0.30, type: 'sawtooth', gain: 0.05 }); },
    echoFroze: function () { tone({ freq: 330, to: 200, dur: 0.22, type: 'triangle', gain: 0.05 }); },
    echoShatter: function () { noise(0.22, 0.09); tone({ freq: 300, to: 90, dur: 0.24, type: 'sawtooth', gain: 0.05 }); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.10, delay: i * 0.10 });
      });
    },
    die: function () {
      tone({ freq: 320, to: 70, dur: 0.4, type: 'sawtooth', gain: 0.09 });
      noise(0.3, 0.06);
    },
    ui: function () { tone({ freq: 620, dur: 0.06, type: 'square', gain: 0.04 }); },
    locked: function () { tone({ freq: 150, dur: 0.14, type: 'square', gain: 0.05 }); },
    scope: function () {
      tone({ freq: 880, to: 1180, dur: 0.16, type: 'sine', gain: 0.06 });
      tone({ freq: 1320, dur: 0.22, type: 'sine', gain: 0.04, delay: 0.08 });
    }
  };

  root.EchoAudio = {
    play: function (name) { if (SOUNDS[name]) SOUNDS[name](); },
    consume: function (events) {
      for (var i = 0; i < events.length; i++) {
        var t = events[i].type;
        if (t === 'playerMove') this.play('move');
        else if (t === 'playerBlocked') this.play('blocked');
        else if (t === 'star') this.play('star');
        else if (t === 'crystal') this.play('crystal');
        else if (t === 'echoBorn') this.play('echoBorn');
        else if (t === 'echoFroze') this.play('echoFroze');
        else if (t === 'echoShatter') this.play('echoShatter');
        else if (t === 'exitLocked') this.play('locked');
        else if (t === 'win') this.play('win');
        else if (t === 'die') this.play('die');
      }
    },
    toggle: function () { muted = !muted; if (!muted) ensure(); return muted; },
    isMuted: function () { return muted; },
    setMuted: function (m) { muted = !!m; if (!muted) ensure(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
