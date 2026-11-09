/*
 * 《长夜点灯》程序化音频
 * 所有声音由 WebAudio 实时合成，无外部资源。
 */
(function (root) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.ambientGain = null;
    this.droneGain = null;
    this.windGain = null;
    this.windFilter = null;
    this.focusGain = null;
    this.focusFilter = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.started = false;
    this.lastSfx = Object.create(null);
    this.ambientSources = [];
    this.focusSource = null;
  }

  AudioEngine.prototype.isReady = function () {
    return !!this.ctx;
  };

  AudioEngine.prototype.init = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        return this.ctx.resume().catch(function () {});
      }
      return Promise.resolve();
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return Promise.resolve();

    var ctx;
    try {
      ctx = new AC();
    } catch (error) {
      return Promise.resolve();
    }
    this.ctx = ctx;

    var compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, ctx.currentTime);
    compressor.knee.setValueAtTime(16, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.006, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);
    compressor.connect(ctx.destination);
    this.compressor = compressor;

    var master = ctx.createGain();
    master.gain.setValueAtTime(this.muted ? 0 : 0.55, ctx.currentTime);
    master.connect(compressor);
    this.master = master;

    this.noiseBuffer = this.makeNoise(ctx, 3.2);
    this.buildAmbient(ctx);
    this.buildFocus(ctx);
    this.started = true;
    if (ctx.state === 'suspended') {
      return ctx.resume().catch(function () {});
    }
    return Promise.resolve();
  };

  AudioEngine.prototype.makeNoise = function (ctx, seconds) {
    var length = Math.floor(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 1.8;
    }
    return buffer;
  };

  AudioEngine.prototype.buildAmbient = function (ctx) {
    var now = ctx.currentTime;
    var ambient = ctx.createGain();
    ambient.gain.setValueAtTime(0.34, now);
    ambient.connect(this.master);
    this.ambientGain = ambient;

    var droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0.032, now);
    var droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.setValueAtTime(240, now);
    droneFilter.Q.setValueAtTime(0.8, now);
    droneGain.connect(droneFilter);
    droneFilter.connect(ambient);
    this.droneGain = droneGain;

    var frequencies = [55, 82.5, 110.3];
    var types = ['sine', 'triangle', 'sine'];
    var volumes = [1, 0.36, 0.16];
    for (var i = 0; i < frequencies.length; i++) {
      var oscillator = ctx.createOscillator();
      oscillator.type = types[i];
      oscillator.frequency.setValueAtTime(frequencies[i], now);
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(volumes[i], now);
      oscillator.connect(gain);
      gain.connect(droneGain);
      oscillator.start(now);
      this.ambientSources.push(oscillator);
    }

    var wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    var windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(420, now);
    windFilter.Q.setValueAtTime(0.7, now);
    var windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.036, now);
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ambient);
    wind.start(now);
    this.ambientSources.push(wind);
    this.windGain = windGain;
    this.windFilter = windFilter;

    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.061, now);
    var lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.014, now);
    lfo.connect(lfoGain);
    lfoGain.connect(windGain.gain);
    lfo.start(now);
    this.ambientSources.push(lfo);

    var lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.setValueAtTime(0.037, now);
    var lfo2Gain = ctx.createGain();
    lfo2Gain.gain.setValueAtTime(60, now);
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(windFilter.frequency);
    lfo2.start(now);
    this.ambientSources.push(lfo2);
  };

  AudioEngine.prototype.buildFocus = function (ctx) {
    var now = ctx.currentTime;
    var source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(920, now);
    filter.Q.setValueAtTime(0.75, now);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    this.focusSource = source;
    this.focusGain = gain;
    this.focusFilter = filter;
  };

  AudioEngine.prototype.ensure = function () {
    if (!this.ctx) return this.init();
    if (this.ctx.state === 'suspended') {
      return this.ctx.resume().catch(function () {});
    }
    return Promise.resolve();
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (!this.ctx || !this.master) return;
    var now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, now, 0.04);
  };

  AudioEngine.prototype.setFocus = function (active, finalPhase) {
    if (!this.ctx || !this.focusGain) return;
    var now = this.ctx.currentTime;
    var target = active ? 0.085 : 0;
    this.focusGain.gain.setTargetAtTime(target, now, 0.06);
    if (this.focusFilter) {
      this.focusFilter.frequency.setTargetAtTime(
        finalPhase ? 1180 : 900,
        now,
        0.08
      );
    }
  };

  AudioEngine.prototype.setTension = function (active) {
    if (!this.ctx || !this.windGain) return;
    var now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(active ? 0.058 : 0.036, now, 0.6);
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(active ? 620 : 420, now, 0.8);
    }
  };

  AudioEngine.prototype.throttle = function (key, ms) {
    if (!this.ctx) return true;
    var now = this.ctx.currentTime * 1000;
    if (this.lastSfx[key] && now - this.lastSfx[key] < ms) return true;
    this.lastSfx[key] = now;
    return false;
  };

  AudioEngine.prototype.tone = function (options) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    var ctx = this.ctx;
    var now = (options.delay || 0) + ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = options.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, options.frequency), now);
    if (options.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        now + (options.duration || 0.2)
      );
    }
    var peak = options.volume === undefined ? 0.12 : options.volume;
    var attack = options.attack === undefined ? 0.006 : options.attack;
    var duration = options.duration || 0.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.04);
  };

  AudioEngine.prototype.noiseBurst = function (options) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    var ctx = this.ctx;
    var now = (options.delay || 0) + ctx.currentTime;
    var source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    var filter = ctx.createBiquadFilter();
    filter.type = options.filterType || 'bandpass';
    filter.frequency.setValueAtTime(options.frequency || 700, now);
    if (options.endFrequency) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.endFrequency), now + (options.duration || 0.2));
    }
    filter.Q.setValueAtTime(options.q || 0.8, now);
    var gain = ctx.createGain();
    var volume = options.volume === undefined ? 0.08 : options.volume;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + (options.attack || 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (options.duration || 0.2));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + (options.duration || 0.2) + 0.03);
  };

  AudioEngine.prototype.ui = function () {
    if (this.throttle('ui', 40)) return;
    this.tone({ frequency: 620, endFrequency: 540, duration: 0.055, volume: 0.045, type: 'sine' });
  };

  AudioEngine.prototype.pickup = function () {
    if (this.throttle('pickup', 55)) return;
    this.tone({ frequency: 880, endFrequency: 1320, duration: 0.16, volume: 0.11, type: 'sine' });
    this.tone({ frequency: 1320, duration: 0.22, volume: 0.045, delay: 0.06, type: 'sine' });
  };

  AudioEngine.prototype.ignite = function () {
    if (this.throttle('ignite', 200)) return;
    this.tone({ frequency: 116, endFrequency: 55, duration: 0.9, volume: 0.2, type: 'sine', attack: 0.03 });
    var partials = [1, 2.01, 2.98, 4.2];
    for (var i = 0; i < partials.length; i++) {
      this.tone({
        frequency: 196 * partials[i],
        duration: 1.5 - i * 0.18,
        volume: 0.075 / (i + 1),
        type: 'sine',
        delay: 0.04 + i * 0.012
      });
    }
    this.noiseBurst({ frequency: 420, endFrequency: 160, duration: 0.55, volume: 0.07, filterType: 'lowpass' });
  };

  AudioEngine.prototype.hit = function () {
    if (this.throttle('hit', 140)) return;
    this.tone({ frequency: 90, endFrequency: 48, duration: 0.18, volume: 0.18, type: 'square', attack: 0.004 });
    this.noiseBurst({ frequency: 260, endFrequency: 90, duration: 0.22, volume: 0.1, filterType: 'lowpass' });
  };

  AudioEngine.prototype.kill = function (size) {
    if (this.throttle('kill', 70)) return;
    var base = size === 'brute' ? 150 : size === 'wraith' ? 240 : 330;
    this.tone({
      frequency: base,
      endFrequency: base * 0.45,
      duration: 0.36,
      volume: size === 'brute' ? 0.11 : 0.06,
      type: 'triangle'
    });
    this.noiseBurst({ frequency: 1100, endFrequency: 320, duration: 0.24, volume: 0.028 });
  };

  AudioEngine.prototype.dash = function () {
    if (this.throttle('dash', 160)) return;
    this.noiseBurst({
      frequency: 600,
      endFrequency: 1900,
      duration: 0.18,
      volume: 0.075,
      filterType: 'bandpass',
      q: 1.4
    });
  };

  AudioEngine.prototype.oilEmpty = function () {
    if (this.throttle('oilEmpty', 1200)) return;
    this.tone({ frequency: 210, endFrequency: 160, duration: 0.18, volume: 0.04, type: 'triangle' });
  };

  AudioEngine.prototype.finale = function () {
    this.tone({ frequency: 73, endFrequency: 55, duration: 2.4, volume: 0.14, type: 'sine', attack: 0.25 });
    this.tone({ frequency: 220, endFrequency: 330, duration: 1.8, volume: 0.045, type: 'sine', attack: 0.35 });
    this.noiseBurst({ frequency: 900, endFrequency: 300, duration: 1.4, volume: 0.05 });
  };

  AudioEngine.prototype.heartbeat = function () {
    if (this.throttle('heartbeat', 700)) return;
    this.tone({ frequency: 58, endFrequency: 42, duration: 0.16, volume: 0.16, type: 'sine', attack: 0.008 });
    this.tone({ frequency: 52, endFrequency: 38, duration: 0.2, volume: 0.095, type: 'sine', attack: 0.008, delay: 0.16 });
  };

  AudioEngine.prototype.victory = function () {
    if (!this.ctx) return;
    this.setFocus(false, false);
    this.setTension(false);
    var notes = [261.63, 329.63, 392.0, 523.25, 659.25];
    for (var i = 0; i < notes.length; i++) {
      this.tone({
        frequency: notes[i],
        duration: 3.2 - i * 0.2,
        volume: 0.075 / (1 + i * 0.35),
        type: 'sine',
        delay: i * 0.18,
        attack: 0.12
      });
    }
    this.tone({ frequency: 130.81, duration: 3.4, volume: 0.08, type: 'triangle', attack: 0.2 });
  };

  AudioEngine.prototype.defeat = function () {
    if (!this.ctx) return;
    this.setFocus(false, false);
    this.setTension(false);
    this.tone({ frequency: 196, endFrequency: 98, duration: 2.2, volume: 0.1, type: 'triangle', attack: 0.08 });
    this.tone({ frequency: 146.8, endFrequency: 73.4, duration: 2.8, volume: 0.075, type: 'sine', attack: 0.2 });
  };

  AudioEngine.prototype.suspend = function () {
    this.setFocus(false, false);
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(function () {});
    }
  };

  AudioEngine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
  };

  root.NightAudio = new AudioEngine();
})(typeof globalThis !== 'undefined' ? globalThis : this);
