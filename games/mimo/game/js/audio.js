'use strict';

/* ============ WebAudio 合成音效（无外部资源） ============ */

const AudioSys = {
  ctx: null,
  muted: false,
  _last: {},

  init() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch (e) {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  play(name, opts, throttleMs) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (throttleMs > 0) {
      if (this._last[name] !== undefined && now - this._last[name] < throttleMs / 1000) return;
      this._last[name] = now;
    }
    const freq = opts.freq || 440;
    const type = opts.type || 'sine';
    const dur = opts.dur || 0.08;
    const vol = opts.vol !== undefined ? opts.vol : 0.15;
    const slide = opts.slide || 0;
    const t0 = now + (opts.delay || 0);
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      }
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* 忽略音频异常，不影响游戏 */ }
  },

  /* ---- 具体音效 ---- */
  shoot()       { this.play('shoot', { freq: 640, type: 'triangle', dur: 0.06, vol: 0.05, slide: -260 }, 70); },
  enemyShoot()  { this.play('eshoot', { freq: 300, type: 'square', dur: 0.07, vol: 0.035, slide: -120 }, 120); },
  kill()        { this.play('kill', { freq: 190, type: 'triangle', dur: 0.09, vol: 0.06, slide: -90 }, 60); },
  eliteDie()    { this.play('edie', { freq: 240, type: 'sawtooth', dur: 0.18, vol: 0.09, slide: -160 }); },
  hurt()        { this.play('hurt', { freq: 170, type: 'square', dur: 0.16, vol: 0.14, slide: -70 }); },
  pickup()      { this.play('pick', { freq: 880, type: 'sine', dur: 0.05, vol: 0.045, slide: 320 }, 55); },
  levelup()     { this.play('lv', { freq: 520, type: 'triangle', dur: 0.12, vol: 0.12 });
                  this.play('lv', { freq: 780, type: 'triangle', dur: 0.14, vol: 0.12, delay: 0.1 });
                  this.play('lv', { freq: 1040, type: 'triangle', dur: 0.18, vol: 0.12, delay: 0.2 }); },
  dash()        { this.play('dash', { freq: 420, type: 'sawtooth', dur: 0.12, vol: 0.07, slide: 480 }, 90); },
  click()       { this.play('click', { freq: 660, type: 'sine', dur: 0.05, vol: 0.08, slide: -180 }); },
  thunder()     { this.play('thd', { freq: 110, type: 'sawtooth', dur: 0.22, vol: 0.11, slide: -60 }); },
  frost()       { this.play('frz', { freq: 980, type: 'sine', dur: 0.22, vol: 0.07, slide: -520 }); },
  boss()        { this.play('boss', { freq: 82, type: 'sawtooth', dur: 0.8, vol: 0.16, slide: -22 });
                  this.play('boss', { freq: 123, type: 'sawtooth', dur: 0.8, vol: 0.1, slide: -30, delay: 0.18 }); },
  bossShoot()   { this.play('bs', { freq: 150, type: 'square', dur: 0.14, vol: 0.08, slide: -60 }, 200); },
  bossDie()     { this.play('bd', { freq: 220, type: 'sawtooth', dur: 0.5, vol: 0.14, slide: -180 });
                  this.play('bd', { freq: 165, type: 'triangle', dur: 0.7, vol: 0.12, slide: -110, delay: 0.16 }); },
  death()       { this.play('dth', { freq: 300, type: 'triangle', dur: 0.5, vol: 0.16, slide: -240 });
                  this.play('dth', { freq: 150, type: 'sine', dur: 0.9, vol: 0.14, slide: -90, delay: 0.22 }); },
  victory()     { this.play('vic', { freq: 523, type: 'triangle', dur: 0.16, vol: 0.12 });
                  this.play('vic', { freq: 659, type: 'triangle', dur: 0.16, vol: 0.12, delay: 0.14 });
                  this.play('vic', { freq: 784, type: 'triangle', dur: 0.3, vol: 0.13, delay: 0.28 }); },
  start()       { this.play('st', { freq: 392, type: 'triangle', dur: 0.12, vol: 0.1 });
                  this.play('st', { freq: 523, type: 'triangle', dur: 0.22, vol: 0.11, delay: 0.12 }); },
};
