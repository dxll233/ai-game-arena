(() => {
  "use strict";

  const W = 1280;
  const H = 720;
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");
  const ui = {
    hud: $("hud"), bossHud: $("bossHud"), dashHud: $("dashHud"),
    menu: $("menuScreen"), pause: $("pauseScreen"), level: $("levelScreen"), end: $("endScreen"),
    hpText: $("hpText"), hpFill: $("hpFill"), xpText: $("xpText"), xpFill: $("xpFill"),
    levelText: $("levelText"), waveLabel: $("waveLabel"), waveProgress: $("waveProgress"),
    scoreText: $("scoreText"), timeText: $("timeText"), dashText: $("dashText"), dashRing: $("dashRing"),
    bossFill: $("bossFill"), bossPhase: $("bossPhase"), announcement: $("announcement"),
    announceTop: $("announceTop"), announceMain: $("announceMain"), announceSub: $("announceSub"),
    upgradeCards: $("upgradeCards"), touch: $("touchControls"), vignette: $("damageVignette"),
    weaponHud: $("weaponHud"), chargeFill: $("chargeFill"), aimAssistText: $("aimAssistText")
  };

  const WEAPONS = {
    pulse: { name: "脉冲枪", color: "#8affed" },
    shotgun: { name: "霰弹枪", color: "#ffd36b" },
    charge: { name: "蓄能枪", color: "#a9b8ff" }
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const formatScore = (n) => Math.floor(n).toString().padStart(6, "0");
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  class SoundEngine {
    constructor() {
      this.context = null;
      this.enabled = true;
      this.lastShot = 0;
    }
    init() {
      if (!this.context) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.context = new AudioCtx();
        } catch (_) { this.context = null; }
      }
      if (this.context && this.context.state === "suspended") this.context.resume().catch(() => {});
    }
    tone(freq, duration, type = "sine", volume = 0.025, slide = 0) {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(this.context.destination);
      osc.start(now);
      osc.stop(now + duration);
    }
    shoot() {
      const now = performance.now();
      if (now - this.lastShot < 65) return;
      this.lastShot = now;
      this.tone(520, 0.055, "square", 0.018, -230);
    }
    hit() { this.tone(150, 0.07, "sawtooth", 0.025, -70); }
    pickup() { this.tone(700, 0.09, "sine", 0.025, 420); }
    dash() { this.tone(180, 0.16, "sawtooth", 0.025, 600); }
    hurt() { this.tone(100, 0.22, "square", 0.045, -55); }
    level() { this.tone(420, 0.35, "sine", 0.04, 700); }
    explode() { this.tone(90, 0.25, "sawtooth", 0.04, -50); }
  }

  const sound = new SoundEngine();
  let nextEnemyId = 1;

  class Game {
    constructor() {
      this.state = "menu";
      this.arena = "harbor";
      // 场地数据在所有状态下都要可用：菜单里选场地时 drawArena() 就会读取它们。
      this.setupArena();
      this.aimAssist = false;
      this.aimTargetId = null;
      this.runId = 0;
      this.combatLog = [];
      this.frameErrors = 0;
      this.keys = Object.create(null);
      this.mouse = { x: W * 0.72, y: H * 0.5, down: false };
      this.joy = { x: 0, y: 0, active: false };
      this.isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
      this.globalTime = 0;
      this.lastTime = performance.now();
      this.stars = Array.from({ length: 120 }, () => ({
        x: rand(0, W), y: rand(0, H), r: rand(0.4, 1.7), a: rand(0.12, 0.7), phase: rand(0, TAU)
      }));
      this.structures = Array.from({ length: 18 }, () => ({
        x: rand(30, W - 30), y: rand(30, H - 30), s: rand(12, 42), rot: rand(0, TAU)
      }));
      this.best = this.loadBest();
      this.updateBestUI();
      this.bindInputs();
      requestAnimationFrame((t) => this.loop(t));
    }

    loadBest() {
      try {
        return JSON.parse(localStorage.getItem("neonHarborBest")) || { score: 0, wave: 0 };
      } catch (_) { return { score: 0, wave: 0 }; }
    }

    saveBest() {
      try { localStorage.setItem("neonHarborBest", JSON.stringify(this.best)); } catch (_) {}
    }

    updateBestUI() {
      $("bestScore").textContent = formatScore(this.best.score || 0);
      $("bestWave").textContent = `最佳波次 ${this.best.wave || 0}`;
    }

    bindInputs() {
      window.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) e.preventDefault();
        this.keys[key] = true;
        if (key === "enter" && this.state === "menu") this.start();
        if (key === "r" && (this.state === "gameover" || this.state === "victory")) this.start();
        if ((key === "p" || key === "escape") && (this.state === "playing" || this.state === "paused")) this.togglePause();
        if (key === " " && !e.repeat && this.state === "playing") this.dash();
        if (!e.repeat && this.state === "playing" && ["1", "2", "3"].includes(key)) this.switchWeapon(["pulse", "shotgun", "charge"][Number(key) - 1]);
        if (!e.repeat && key === "q" && this.state === "playing") this.cycleWeapon();
        if (!e.repeat && key === "h" && this.state === "playing") {
          this.aimAssist = !this.aimAssist;
          this.aimTargetId = null;
          this.announce("AIM PROTOCOL", `瞄准辅助：${this.aimAssist ? "开" : "关"}`, this.aimAssist ? "稳定锁定最近机体" : "恢复纯鼠标瞄准");
        }
        if (this.state === "levelup" && ["1", "2", "3"].includes(key)) {
          const card = ui.upgradeCards.children[Number(key) - 1];
          if (card) card.click();
        }
      });
      window.addEventListener("keyup", (e) => { this.keys[e.key.toLowerCase()] = false; });
      window.addEventListener("blur", () => {
        this.mouse.down = false;
        this.keys = Object.create(null);
        if (this.state === "playing") this.togglePause();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        const p = this.toGameCoords(e.clientX, e.clientY);
        this.mouse.x = p.x;
        this.mouse.y = p.y;
      });
      canvas.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") return;
        sound.init();
        if (e.button === 0) this.mouse.down = true;
        if (e.button === 2 && this.state === "playing") this.dash();
      });
      window.addEventListener("pointerup", (e) => {
        if (e.button === 0) this.mouse.down = false;
      });
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());

      $("startBtn").addEventListener("click", () => this.start());
      $("arenaHarbor").addEventListener("click", () => this.selectArena("harbor"));
      $("arenaFoundry").addEventListener("click", () => this.selectArena("foundry"));
      ["pulse", "shotgun", "charge"].forEach((weapon) => {
        $(`weapon${weapon[0].toUpperCase()}${weapon.slice(1)}`).addEventListener("click", () => this.switchWeapon(weapon));
      });
      $("touchWeapon").addEventListener("pointerdown", (e) => { e.preventDefault(); this.cycleWeapon(); });
      $("restartBtn").addEventListener("click", () => this.start());
      $("pauseRestartBtn").addEventListener("click", () => this.start());
      $("resumeBtn").addEventListener("click", () => this.togglePause());
      $("pauseBtn").addEventListener("click", () => {
        if (this.state === "playing" || this.state === "paused") this.togglePause();
      });
      $("menuBtn").addEventListener("click", () => this.toMenu());
      $("soundBtn").addEventListener("click", () => {
        sound.init();
        sound.enabled = !sound.enabled;
        $("soundBtn").textContent = sound.enabled ? "声音：开" : "声音：关";
      });
      this.bindJoystick();
    }

    selectArena(arena) {
      if (this.state !== "menu" || !["harbor", "foundry"].includes(arena)) return;
      this.arena = arena;
      // 切换场地时同步重建场地数据，菜单背景与首帧渲染都能安全读取。
      this.setupArena();
      $("arenaHarbor").classList.toggle("selected", arena === "harbor");
      $("arenaFoundry").classList.toggle("selected", arena === "foundry");
      const label = $("startBtn").querySelector("span");
      if (label) label.textContent = `开始守夜 · ${arena === "foundry" ? "熔炉环线" : "开放泊位"}`;
    }

    switchWeapon(weapon) {
      if (this.state !== "playing" || !WEAPONS[weapon] || !this.player) return;
      if (this.player.weapon === weapon) return;
      this.player.weapon = weapon;
      this.player.charge = 0;
      this.player.fireTimer = Math.min(this.player.fireTimer, 0.12);
      this.aimTargetId = null;
      $("touchWeapon").innerHTML = `${WEAPONS[weapon].name}<small>切换武器</small>`;
      this.updateHUD();
    }

    cycleWeapon() {
      if (!this.player) return;
      const types = Object.keys(WEAPONS);
      this.switchWeapon(types[(types.indexOf(this.player.weapon) + 1) % types.length]);
    }

    bindJoystick() {
      const joystick = $("joystick");
      const stick = $("stick");
      const update = (e) => {
        const rect = joystick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const max = rect.width * 0.32;
        const len = Math.hypot(dx, dy);
        if (len > max) { dx *= max / len; dy *= max / len; }
        this.joy.x = dx / max;
        this.joy.y = dy / max;
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      joystick.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.joy.active = true;
        joystick.setPointerCapture(e.pointerId);
        update(e);
      });
      joystick.addEventListener("pointermove", (e) => {
        if (this.joy.active) update(e);
      });
      const release = () => {
        this.joy.active = false;
        this.joy.x = 0;
        this.joy.y = 0;
        stick.style.transform = "translate(0, 0)";
      };
      joystick.addEventListener("pointerup", release);
      joystick.addEventListener("pointercancel", release);
      $("touchDash").addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (this.state === "playing") this.dash();
      });
    }

    toGameCoords(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return { x: (clientX - rect.left) * W / rect.width, y: (clientY - rect.top) * H / rect.height };
    }

    start() {
      sound.init();
      this.runId += 1;
      this.keys = Object.create(null);
      this.joy.x = 0;
      this.joy.y = 0;
      this.joy.active = false;
      this.aimAssist = false;
      this.aimTargetId = null;
      this.combatLog = [];
      this.player = {
        x: W / 2, y: H / 2, r: 16, angle: 0,
        hp: 100, maxHp: 100, speed: 260,
        damage: 22, fireRate: 0.22, fireTimer: 0, bulletSpeed: 790,
        weapon: "pulse", charge: 0, chargeMin: 0.25, chargeMax: 1.15, chargeRate: 1,
        multishot: 1, pierce: 0, crit: 0,
        level: 1, xp: 0, xpNext: 50, magnet: 110, regen: 0,
        invuln: 0, dashTime: 0, dashCooldown: 0, dashMax: 2.4,
        dashDirX: 1, dashDirY: 0, trailTimer: 0
      };
      this.enemies = [];
      this.bullets = [];
      this.gems = [];
      this.hazards = [];
      this.particles = [];
      this.texts = [];
      this.setupArena();
      this.score = 0;
      this.kills = 0;
      this.elapsed = 0;
      this.wave = 0;
      this.waveKills = 0;
      this.waveQuota = 0;
      this.spawned = 0;
      this.spawnTimer = 0;
      this.waveClearTimer = 0;
      this.boss = null;
      this.mouse.down = false;
      this.state = "playing";
      $("pauseBtn").textContent = "暂停";
      this.hideAllOverlays();
      ui.hud.classList.remove("hidden");
      ui.dashHud.classList.remove("hidden");
      ui.weaponHud.classList.remove("hidden");
      ui.bossHud.classList.add("hidden");
      $("touchWeapon").innerHTML = "脉冲枪<small>切换武器</small>";
      $("stick").style.transform = "translate(0, 0)";
      if (this.isTouch) ui.touch.classList.remove("hidden");
      this.nextWave();
      this.updateHUD();
    }

    toMenu() {
      this.state = "menu";
      this.hideAllOverlays();
      ui.menu.classList.remove("hidden");
      ui.hud.classList.add("hidden");
      ui.dashHud.classList.add("hidden");
      ui.weaponHud.classList.add("hidden");
      ui.bossHud.classList.add("hidden");
      ui.touch.classList.add("hidden");
      this.updateBestUI();
    }

    hideAllOverlays() {
      [ui.menu, ui.pause, ui.level, ui.end].forEach((el) => el.classList.add("hidden"));
    }

    togglePause() {
      if (this.state === "playing") {
        this.state = "paused";
        this.mouse.down = false;
        ui.pause.classList.remove("hidden");
        ui.touch.classList.add("hidden");
        $("pauseBtn").textContent = "继续";
      } else if (this.state === "paused") {
        this.state = "playing";
        ui.pause.classList.add("hidden");
        if (this.isTouch) ui.touch.classList.remove("hidden");
        $("pauseBtn").textContent = "暂停";
        this.lastTime = performance.now();
      }
    }

    setupArena() {
      this.obstacles = this.arena === "foundry" ? [
        { x: 278, y: 164, w: 88, h: 252 },
        { x: 914, y: 304, w: 88, h: 252 },
        { x: 565, y: 82, w: 150, h: 62 }
      ] : [];
      this.arenaHazard = { phase: "idle", timer: 4, orientation: 0 };
    }

    arenaHazardRect() {
      if (!this.arenaHazard) return null;
      return this.arenaHazard.orientation % 2 === 0
        ? { x: W / 2 - 62, y: 0, w: 124, h: H }
        : { x: 0, y: H / 2 - 62, w: W, h: 124 };
    }

    pointInRect(x, y, rect) {
      return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    }

    resolveObstacles(entity) {
      for (const rect of this.obstacles) {
        const cx = clamp(entity.x, rect.x, rect.x + rect.w);
        const cy = clamp(entity.y, rect.y, rect.y + rect.h);
        const dx = entity.x - cx;
        const dy = entity.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < entity.r * entity.r) {
          const d = Math.sqrt(d2);
          const push = entity.r - d;
          entity.x += dx / d * push;
          entity.y += dy / d * push;
        } else if (this.pointInRect(entity.x, entity.y, rect)) {
          const sides = [
            { d: entity.x - rect.x, x: rect.x - entity.r, y: entity.y },
            { d: rect.x + rect.w - entity.x, x: rect.x + rect.w + entity.r, y: entity.y },
            { d: entity.y - rect.y, x: entity.x, y: rect.y - entity.r },
            { d: rect.y + rect.h - entity.y, x: entity.x, y: rect.y + rect.h + entity.r }
          ].sort((a, b) => a.d - b.d)[0];
          entity.x = sides.x;
          entity.y = sides.y;
        }
      }
    }

    updateArena(dt) {
      if (this.arena !== "foundry" || this.state !== "playing") return;
      const h = this.arenaHazard;
      h.timer -= dt;
      if (h.timer > 0) {
        if (h.phase === "active" && this.pointInRect(this.player.x, this.player.y, this.arenaHazardRect())) {
          this.hurtPlayer(14, "arena");
        }
        return;
      }
      if (h.phase === "idle") { h.phase = "warning"; h.timer = 1.2; }
      else if (h.phase === "warning") { h.phase = "active"; h.timer = 1; sound.tone(85, 0.35, "sawtooth", 0.035, 90); }
      else { h.phase = "idle"; h.timer = 4.5; h.orientation += 1; }
    }

    nextWave() {
      this.wave += 1;
      this.waveKills = 0;
      this.spawned = 0;
      this.waveClearTimer = 0;
      this.spawnTimer = 1.2;
      if (this.wave <= 5) {
        this.waveQuota = [8, 12, 16, 20, 24][this.wave - 1];
        this.announce(`WAVE 0${this.wave}`, this.wave === 1 ? "机械潮来袭" : `第 ${this.wave} 波`, `击败 ${this.waveQuota} 个失控机体`);
      } else {
        this.waveQuota = 1;
        this.spawnBoss();
        this.announce("FINAL PROTOCOL", "中枢核心", "终止失控源头");
      }
      this.updateHUD();
    }

    announce(top, main, sub) {
      ui.announceTop.textContent = top;
      ui.announceMain.textContent = main;
      ui.announceSub.textContent = sub;
      ui.announcement.classList.add("hidden");
      void ui.announcement.offsetWidth;
      ui.announcement.classList.remove("hidden");
      clearTimeout(this.announceTimer);
      this.announceTimer = setTimeout(() => ui.announcement.classList.add("hidden"), 2450);
    }

    spawnEnemy(type, x, y) {
      if (x === undefined) {
        const edge = Math.floor(rand(0, 4));
        if (edge === 0) { x = rand(20, W - 20); y = -35; }
        if (edge === 1) { x = W + 35; y = rand(20, H - 20); }
        if (edge === 2) { x = rand(20, W - 20); y = H + 35; }
        if (edge === 3) { x = -35; y = rand(20, H - 20); }
      }
      const scale = 1 + Math.max(0, this.wave - 1) * 0.13;
      const specs = {
        chaser: { r: 15, hp: 44, speed: 112, damage: 12, xp: 13, score: 100 },
        shooter: { r: 17, hp: 68, speed: 82, damage: 10, xp: 19, score: 170 },
        tank: { r: 25, hp: 155, speed: 56, damage: 22, xp: 29, score: 260 },
        shielder: { r: 20, hp: 105, speed: 76, damage: 16, xp: 24, score: 230 },
        miner: { r: 18, hp: 76, speed: 70, damage: 12, xp: 25, score: 240 },
        minion: { r: 12, hp: 34, speed: 138, damage: 10, xp: 8, score: 70 }
      };
      const s = specs[type];
      const enemy = {
        id: nextEnemyId++, type, x, y, r: s.r, hp: s.hp * scale, maxHp: s.hp * scale,
        speed: s.speed * (1 + this.wave * 0.018), damage: s.damage, xp: s.xp, score: s.score,
        angle: rand(0, TAU), shootTimer: rand(0.7, 1.8), flash: 0, dead: false
      };
      this.enemies.push(enemy);
      return enemy;
    }

    spawnBoss() {
      const boss = {
        id: nextEnemyId++, type: "boss", x: W / 2, y: -80, r: 62,
        hp: 1700, maxHp: 1700, speed: 64, damage: 28, xp: 0, score: 5000,
        angle: 0, shootTimer: 2, summonTimer: 4, specialTimer: 3.2,
        pendingAttack: null, attackIndex: 0, flash: 0, dead: false, phase: 1
      };
      this.enemies.push(boss);
      this.boss = boss;
      ui.bossHud.classList.remove("hidden");
    }

    dash() {
      const p = this.player;
      if (!p || p.dashCooldown > 0 || p.dashTime > 0) return;
      const move = this.getMoveVector();
      if (Math.hypot(move.x, move.y) > 0.1) {
        p.dashDirX = move.x;
        p.dashDirY = move.y;
      } else {
        p.dashDirX = Math.cos(p.angle);
        p.dashDirY = Math.sin(p.angle);
      }
      p.dashTime = 0.18;
      p.dashCooldown = p.dashMax;
      p.invuln = Math.max(p.invuln, 0.28);
      sound.dash();
      this.burst(p.x, p.y, "#57f5e3", 12, 170);
    }

    getMoveVector() {
      let x = 0;
      let y = 0;
      if (this.keys.w || this.keys.arrowup) y -= 1;
      if (this.keys.s || this.keys.arrowdown) y += 1;
      if (this.keys.a || this.keys.arrowleft) x -= 1;
      if (this.keys.d || this.keys.arrowright) x += 1;
      if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
      const len = Math.hypot(x, y);
      return len > 1 ? { x: x / len, y: y / len } : { x, y };
    }

    nearestEnemy() {
      let best = null;
      let bestD = Infinity;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = (e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    }

    updatePlayer(dt) {
      const p = this.player;
      p.fireTimer -= dt;
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      p.invuln = Math.max(0, p.invuln - dt);
      if (p.regen > 0 && p.hp > 0 && p.hp < p.maxHp) this.healPlayer(p.regen * dt, "regen");
      const move = this.getMoveVector();
      const chargeSlow = p.weapon === "charge" && p.charge > 0 ? 0.72 : 1;

      if (p.dashTime > 0) {
        p.dashTime -= dt;
        p.x += p.dashDirX * 880 * dt;
        p.y += p.dashDirY * 880 * dt;
        p.trailTimer -= dt;
        if (p.trailTimer <= 0) {
          p.trailTimer = 0.025;
          this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, maxLife: 0.25, size: 18, color: "#57f5e3", ghost: true });
        }
      } else {
        p.x += move.x * p.speed * chargeSlow * dt;
        p.y += move.y * p.speed * chargeSlow * dt;
      }
      p.x = clamp(p.x, 22, W - 22);
      p.y = clamp(p.y, 22, H - 22);
      this.resolveObstacles(p);

      let target = null;
      if (this.isTouch) target = this.nearestEnemy();
      else if (this.aimAssist) target = this.assistedEnemy();
      if (target) {
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      } else if (!this.isTouch) {
        p.angle = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      } else if (Math.hypot(move.x, move.y) > 0.1) {
        p.angle = Math.atan2(move.y, move.x);
      }

      const firing = this.mouse.down || this.keys.j || (this.isTouch && target);
      if (p.weapon === "charge") {
        if (firing) {
          if (p.fireTimer <= 0) p.charge = Math.min(p.chargeMax, p.charge + dt * p.chargeRate);
          if (this.isTouch && p.charge >= p.chargeMax && p.fireTimer <= 0) {
            this.fireWeapon();
            p.fireTimer = this.getFireInterval();
            p.charge = 0;
          }
        } else if (p.charge > 0) {
          if (p.charge >= p.chargeMin && p.fireTimer <= 0) {
            this.fireWeapon();
            p.fireTimer = this.getFireInterval();
          }
          p.charge = 0;
        }
      } else if (firing && p.fireTimer <= 0) {
        this.fireWeapon();
        p.fireTimer = this.getFireInterval();
      }
    }

    assistedEnemy() {
      let target = this.enemies.find((e) => e.id === this.aimTargetId && !e.dead);
      if (!target) {
        target = this.nearestEnemy();
        this.aimTargetId = target ? target.id : null;
      }
      return target;
    }

    getFireInterval() {
      const p = this.player;
      if (p.weapon === "shotgun") return p.fireRate * 3.1;
      if (p.weapon === "charge") return p.fireRate * 2.2;
      return p.fireRate;
    }

    fireWeapon() {
      const p = this.player;
      const type = p.weapon;
      const chargeRatio = type === "charge" ? clamp(p.charge / p.chargeMax, 0, 1) : 0;
      const count = type === "shotgun" ? Math.min(9, 5 + p.multishot - 1) : type === "pulse" ? p.multishot : 1;
      const spread = type === "shotgun" ? 0.5 : 0.115;
      for (let i = 0; i < count; i++) {
        const offset = type === "charge" ? 0 : (i - (count - 1) / 2) * (type === "shotgun" ? spread / Math.max(1, count - 1) : spread);
        const jitter = type === "shotgun" ? rand(-0.025, 0.025) : 0;
        const angle = p.angle + offset + jitter;
        const critical = Math.random() < p.crit;
        let damage = p.damage;
        let speed = p.bulletSpeed;
        let life = 1.4;
        let radius = critical ? 5 : 3.5;
        let pierce = p.pierce;
        if (type === "shotgun") {
          damage *= 0.4;
          speed = 720;
          life = 0.52;
          radius = 3;
        } else if (type === "charge") {
          damage *= 1.8 + chargeRatio * 2.8;
          speed = 1120;
          life = 1.35;
          radius = 5 + chargeRatio * 5;
          pierce += 1 + Math.round(chargeRatio * 2) + Math.max(0, p.multishot - 1);
        } else if (count > 1) damage *= 0.88;
        if (critical) damage *= 2;
        this.bullets.push({
          x: p.x + Math.cos(angle) * 24, y: p.y + Math.sin(angle) * 24,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          r: radius, damage, friendly: true, life, weapon: type, chargeRatio,
          pierce, critical, hitIds: [], dead: false
        });
      }
      this.particles.push({ x: p.x + Math.cos(p.angle) * 27, y: p.y + Math.sin(p.angle) * 27, vx: 0, vy: 0, life: 0.1, maxLife: 0.1, size: type === "charge" ? 18 : 11, color: WEAPONS[type].color });
      sound.shoot();
    }

    updateSpawner(dt) {
      if (this.wave > 5 || this.waveClearTimer > 0) return;
      if (this.spawned < this.waveQuota) {
        this.spawnTimer -= dt;
        const activeCap = 5 + this.wave * 2;
        if (this.spawnTimer <= 0 && this.enemies.length < activeCap) {
          const roll = Math.random();
          let type = "chaser";
          if (this.wave >= 4) {
            if (roll < 0.16) type = "tank";
            else if (roll < 0.34) type = "shielder";
            else if (roll < 0.48) type = "miner";
            else if (roll < 0.7) type = "shooter";
          } else if (this.wave === 3) {
            if (roll < 0.2) type = "miner";
            else if (roll < 0.45) type = "shielder";
            else if (roll < 0.7) type = "shooter";
          } else if (this.wave === 2) {
            if (roll < 0.28) type = "shielder";
            else if (roll < 0.58) type = "shooter";
          }
          this.spawnEnemy(type);
          this.spawned += 1;
          this.spawnTimer = Math.max(0.32, 1.05 - this.wave * 0.1) * rand(0.75, 1.2);
        }
      }
    }

    updateEnemies(dt) {
      const p = this.player;
      for (const e of this.enemies) {
        if (e.dead) continue;
        e.flash = Math.max(0, e.flash - dt);
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / d;
        const ny = dy / d;
        const desiredAngle = Math.atan2(dy, dx);
        if (e.type === "shielder") {
          const turn = Math.atan2(Math.sin(desiredAngle - e.angle), Math.cos(desiredAngle - e.angle));
          e.angle += clamp(turn, -2.2 * dt, 2.2 * dt);
        } else e.angle = desiredAngle;

        if (e.type === "chaser" || e.type === "tank" || e.type === "minion" || e.type === "shielder") {
          e.x += nx * e.speed * dt;
          e.y += ny * e.speed * dt;
        } else if (e.type === "shooter") {
          const direction = d > 330 ? 1 : d < 220 ? -1 : 0;
          e.x += (nx * direction - ny * 0.28) * e.speed * dt;
          e.y += (ny * direction + nx * 0.28) * e.speed * dt;
          e.shootTimer -= dt;
          if (e.shootTimer <= 0 && d < 620) {
            this.enemyShot(e, Math.atan2(dy, dx), 250, 11);
            e.shootTimer = rand(1.55, 2.05);
          }
        } else if (e.type === "miner") {
          const direction = d > 360 ? 1 : d < 250 ? -1 : 0;
          e.x += (nx * direction + ny * 0.42) * e.speed * dt;
          e.y += (ny * direction - nx * 0.42) * e.speed * dt;
          e.shootTimer -= dt;
          if (e.shootTimer <= 0 && d < 650) {
            this.hazards.push({ kind: "mine", x: e.x, y: e.y, r: 13, triggerRadius: 82, damage: 16, hp: 28, arm: 0.65, timer: 6, maxTime: 6, dead: false });
            e.shootTimer = rand(2.5, 3.1);
          }
        } else if (e.type === "boss") {
          this.updateBoss(e, dt, d, nx, ny);
        }

        e.x = clamp(e.x, -70, W + 70);
        e.y = clamp(e.y, -70, H + 70);
        this.resolveObstacles(e);
        if (d < p.r + e.r && p.invuln <= 0) {
          this.hurtPlayer(e.damage, "contact");
          p.x += nx * 24;
          p.y += ny * 24;
          e.x -= nx * 18;
          e.y -= ny * 18;
        }
      }
    }

    updateBoss(e, dt, d, nx, ny) {
      if (e.hp < e.maxHp * 0.5 && e.phase === 1) {
        e.phase = 2;
        e.speed *= 1.3;
        this.announce("CORE OVERDRIVE", "核心过载", "弹幕密度提升 · 侦测到增援");
        this.burst(e.x, e.y, "#ff5f79", 40, 300);
      }
      if (d > 250) {
        e.x += nx * e.speed * dt;
        e.y += ny * e.speed * dt;
      } else {
        e.x += -ny * e.speed * 0.55 * dt;
        e.y += nx * e.speed * 0.55 * dt;
      }
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        const count = e.phase === 2 ? 18 : 12;
        const offset = this.globalTime * 0.45;
        for (let i = 0; i < count; i++) {
          this.enemyShot(e, offset + i * TAU / count, e.phase === 2 ? 220 : 190, 13);
        }
        e.shootTimer = e.phase === 2 ? 1.25 : 1.8;
        sound.tone(120, 0.2, "sawtooth", 0.035, 70);
      }
      if (e.pendingAttack) {
        e.pendingAttack.timer -= dt;
        if (e.pendingAttack.timer <= 0) {
          const count = e.phase === 2 ? 5 : 3;
          for (let i = 0; i < count; i++) {
            const angle = e.pendingAttack.angle + (i - (count - 1) / 2) * 0.12;
            this.enemyShot(e, angle, e.phase === 2 ? 430 : 370, 16);
          }
          e.pendingAttack = null;
          sound.tone(210, 0.18, "square", 0.035, 220);
        }
      } else {
        e.specialTimer -= dt;
        if (e.specialTimer <= 0) {
          if (e.attackIndex % 2 === 0) {
            e.pendingAttack = { type: "lance", timer: 0.75, angle: Math.atan2(this.player.y - e.y, this.player.x - e.x) };
          } else {
            const count = e.phase === 2 ? 3 : 1;
            for (let i = 0; i < count; i++) {
              const angle = i * TAU / count;
              const radius = i === 0 ? 0 : 105;
              this.hazards.push({
                kind: "blast", x: clamp(this.player.x + Math.cos(angle) * radius, 90, W - 90),
                y: clamp(this.player.y + Math.sin(angle) * radius, 90, H - 90),
                r: 96, damage: 22, timer: 0.9, maxTime: 0.9, dead: false
              });
            }
            sound.tone(135, 0.4, "sine", 0.03, -40);
          }
          e.attackIndex += 1;
          e.specialTimer = e.phase === 2 ? 2.8 : 4.2;
        }
      }
      if (e.phase === 2) {
        e.summonTimer -= dt;
        if (e.summonTimer <= 0 && this.enemies.length < 18) {
          for (let i = 0; i < 3; i++) {
            const a = i * TAU / 3 + rand(0, 1);
            this.spawnEnemy("minion", e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90);
          }
          e.summonTimer = 4.5;
        }
      }
    }

    updateHazards(dt) {
      const p = this.player;
      for (const h of this.hazards) {
        if (h.dead) continue;
        h.timer -= dt;
        if (h.kind === "mine") {
          h.arm = Math.max(0, h.arm - dt);
          const d = distance(h, p);
          if (h.arm <= 0 && d < h.triggerRadius) {
            h.dead = true;
            this.burst(h.x, h.y, "#ffc866", 22, 220);
            this.hurtPlayer(h.damage, "mine");
          } else if (h.timer <= 0) h.dead = true;
        } else if (h.kind === "blast" && h.timer <= 0) {
          h.dead = true;
          this.burst(h.x, h.y, "#ff5f79", 28, 260);
          if (distance(h, p) < h.r + p.r) this.hurtPlayer(h.damage, "boss-blast");
        }
      }
      this.hazards = this.hazards.filter((h) => !h.dead);
    }

    enemyShot(e, angle, speed, damage) {
      this.bullets.push({
        x: e.x + Math.cos(angle) * (e.r + 6), y: e.y + Math.sin(angle) * (e.r + 6),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        r: e.type === "boss" ? 6 : 5, damage, friendly: false, life: 5, dead: false
      });
    }

    updateBullets(dt) {
      for (const b of this.bullets) {
        if (b.dead) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < -100 || b.x > W + 100 || b.y < -100 || b.y > H + 100) {
          b.dead = true;
          continue;
        }
        if (this.obstacles.some((rect) => this.pointInRect(b.x, b.y, rect))) {
          b.dead = true;
          this.burst(b.x, b.y, "#6c8b96", 3, 55);
          continue;
        }
        if (b.friendly) {
          for (const e of this.enemies) {
            if (e.dead || b.hitIds.includes(e.id)) continue;
            const rr = b.r + e.r;
            if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < rr * rr) {
              b.hitIds.push(e.id);
              this.damageEnemy(e, b.damage, b.critical, b);
              if (b.pierce > 0) b.pierce -= 1;
              else { b.dead = true; break; }
            }
          }
          if (!b.dead) {
            for (const h of this.hazards) {
              if (h.kind !== "mine" || h.dead) continue;
              const rr = b.r + h.r;
              if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < rr * rr) {
                h.hp -= b.damage;
                b.dead = true;
                if (h.hp <= 0) {
                  h.dead = true;
                  this.score += 25;
                  this.burst(h.x, h.y, "#ffd36b", 10, 130);
                }
                break;
              }
            }
          }
        } else {
          const p = this.player;
          const rr = b.r + p.r;
          if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < rr * rr) {
            b.dead = true;
            if (p.invuln <= 0) this.hurtPlayer(b.damage, "enemy-bullet");
          }
        }
      }
      this.bullets = this.bullets.filter((b) => !b.dead);
      this.enemies = this.enemies.filter((e) => !e.dead);
    }

    damageEnemy(e, amount, critical, bullet = null) {
      let blocked = false;
      if (e.type === "shielder" && bullet) {
        const sourceAngle = Math.atan2(-bullet.vy, -bullet.vx);
        if (Math.cos(sourceAngle - e.angle) > 0.25) {
          amount *= 0.3;
          blocked = true;
        }
      }
      e.hp -= amount;
      e.flash = 0.08;
      this.texts.push({ x: e.x + rand(-8, 8), y: e.y - e.r, text: blocked ? `格挡 ${Math.round(amount)}` : Math.round(amount).toString(), color: blocked ? "#79b9ff" : critical ? "#ffd36b" : "#b6fff5", life: 0.55, maxLife: 0.55, size: critical ? 18 : 12 });
      this.burst(e.x, e.y, e.type === "boss" ? "#ff6b82" : "#76e9e1", critical ? 8 : 3, 90);
      if (e.hp <= 0) this.killEnemy(e);
    }

    killEnemy(e) {
      if (e.dead) return;
      e.dead = true;
      this.kills += 1;
      this.score += e.score;
      if (this.wave <= 5) this.waveKills += 1;
      this.burst(e.x, e.y, e.type === "boss" ? "#ff6a7f" : e.type === "tank" ? "#ffae63" : "#57f5e3", e.type === "boss" ? 80 : 18, e.type === "boss" ? 380 : 190);
      if (e.type === "boss") {
        sound.explode();
        this.endGame(true);
        return;
      }
      const pieces = e.type === "tank" ? 3 : e.type === "shielder" ? 2 : 1;
      for (let i = 0; i < pieces; i++) {
        this.gems.push({ x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), vx: rand(-45, 45), vy: rand(-45, 45), r: 6, value: e.xp / pieces, life: 18, phase: rand(0, TAU) });
      }
      sound.hit();
    }

    logCombat(kind, source, before, after) {
      this.combatLog.push({ kind, source, before, after, time: this.elapsed });
      if (this.combatLog.length > 400) this.combatLog.shift();
    }

    healPlayer(amount, source) {
      const p = this.player;
      if (!p || p.hp <= 0 || ["menu", "gameover", "victory"].includes(this.state)) return 0;
      const before = p.hp;
      p.hp = clamp(p.hp + amount, 0, p.maxHp);
      if (p.hp !== before) this.logCombat("heal", source, before, p.hp);
      return p.hp - before;
    }

    hurtPlayer(amount, source = "unknown") {
      const p = this.player;
      if (p.invuln > 0 || p.dashTime > 0 || this.state !== "playing") return;
      const before = p.hp;
      p.hp -= amount;
      p.invuln = 0.72;
      this.logCombat("hurt", source, before, Math.max(0, p.hp));
      sound.hurt();
      this.burst(p.x, p.y, "#ff5f79", 16, 220);
      this.texts.push({ x: p.x, y: p.y - 28, text: `-${Math.round(amount)}`, color: "#ff7b8c", life: 0.75, maxLife: 0.75, size: 18 });
      ui.vignette.classList.add("hit");
      clearTimeout(this.vignetteTimer);
      this.vignetteTimer = setTimeout(() => ui.vignette.classList.remove("hit"), 140);
      if (p.hp <= 0) {
        p.hp = 0;
        this.burst(p.x, p.y, "#8affee", 50, 300);
        this.endGame(false);
      }
    }

    updateGems(dt) {
      const p = this.player;
      for (const g of this.gems) {
        g.life -= dt;
        g.phase += dt * 4;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.vx *= Math.pow(0.05, dt);
        g.vy *= Math.pow(0.05, dt);
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        if (d < p.magnet) {
          const force = 500 + (p.magnet - d) * 7;
          g.x += dx / d * force * dt;
          g.y += dy / d * force * dt;
        }
        if (d < p.r + g.r + 5) {
          g.life = -1;
          p.xp += g.value;
          this.score += 10;
          sound.pickup();
          this.burst(g.x, g.y, "#6baaff", 5, 90);
        }
      }
      this.gems = this.gems.filter((g) => g.life > 0);
      if (p.xp >= p.xpNext && this.state === "playing") this.openUpgrade();
    }

    openUpgrade() {
      const p = this.player;
      if (this.state !== "playing" || p.xp < p.xpNext) return;
      const upgradeRunId = this.runId;
      p.xp -= p.xpNext;
      p.level += 1;
      p.xpNext = Math.floor(50 * Math.pow(1.32, p.level - 1));
      this.state = "levelup";
      this.mouse.down = false;
      ui.touch.classList.add("hidden");
      ui.level.classList.remove("hidden");
      sound.level();
      const pool = this.getUpgrades();
      const choices = [];
      while (choices.length < 3 && pool.length) {
        const index = Math.floor(Math.random() * pool.length);
        choices.push(pool.splice(index, 1)[0]);
      }
      ui.upgradeCards.innerHTML = "";
      choices.forEach((upgrade, index) => {
        const button = document.createElement("button");
        button.className = "upgrade-card";
        button.innerHTML = `<span class="num">0${index + 1}</span><span class="card-icon"><i>${upgrade.icon}</i></span><strong>${upgrade.name}</strong><p>${upgrade.desc}</p><small>${upgrade.tag}</small>`;
        button.addEventListener("click", () => {
          upgrade.apply(p);
          ui.level.classList.add("hidden");
          this.state = "playing";
          if (this.isTouch) ui.touch.classList.remove("hidden");
          this.announce("AUGMENT INSTALLED", upgrade.name, "强化已写入机体");
          this.updateHUD();
          if (p.xp >= p.xpNext) setTimeout(() => {
            if (this.runId === upgradeRunId && this.state === "playing" && this.player.xp >= this.player.xpNext) this.openUpgrade();
          }, 250);
        }, { once: true });
        ui.upgradeCards.appendChild(button);
      });
    }

    getUpgrades() {
      return [
        { name: "高能弹头", desc: "全部武器伤害提高 25%。", tag: "FIREPOWER", icon: "+", apply: (p) => { p.damage *= 1.25; } },
        { name: "超频扳机", desc: "脉冲/霰弹射击与蓄能发射恢复间隔缩短 18%。", tag: "FIREPOWER", icon: "»", apply: (p) => { p.fireRate = Math.max(0.065, p.fireRate * 0.82); } },
        { name: "双联脉冲", desc: "脉冲/霰弹增加弹丸；蓄能枪增加穿透。", tag: "WEAPON MOD", icon: "⋈", apply: (p) => { p.multishot = Math.min(5, p.multishot + 1); } },
        { name: "扩容电池", desc: "最大生命增加 25，并立即恢复 25 点。", tag: "SURVIVAL", icon: "□", apply: (p) => { p.maxHp += 25; this.healPlayer(25, "upgrade-capacity"); } },
        { name: "纳米修复", desc: "恢复 35 点生命，每秒持续恢复 0.6 点。", tag: "SURVIVAL", icon: "＋", apply: (p) => { this.healPlayer(35, "upgrade-nano"); p.regen += 0.6; } },
        { name: "轻量骨架", desc: "移动速度提高 12%。", tag: "MOBILITY", icon: "△", apply: (p) => { p.speed *= 1.12; } },
        { name: "相位冲刺", desc: "冲刺冷却时间缩短 18%。", tag: "MOBILITY", icon: "›", apply: (p) => { p.dashMax = Math.max(0.75, p.dashMax * 0.82); } },
        { name: "强磁线圈", desc: "能量晶体拾取范围提高 45%。", tag: "UTILITY", icon: "◎", apply: (p) => { p.magnet *= 1.45; } },
        { name: "穿透弹芯", desc: "弹丸可额外穿透一个目标。", tag: "WEAPON MOD", icon: "→", apply: (p) => { p.pierce = Math.min(4, p.pierce + 1); } },
        { name: "暴击模块", desc: "暴击率增加 12%，暴击造成双倍伤害。", tag: "FIREPOWER", icon: "×", apply: (p) => { p.crit = Math.min(0.72, p.crit + 0.12); } }
      ];
    }

    burst(x, y, color, count, speed) {
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const v = rand(speed * 0.25, speed);
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.2, 0.65), maxLife: 0.65, size: rand(1.5, 4.5), color });
      }
      if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }

    updateEffects(dt) {
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(0.08, dt);
        p.vy *= Math.pow(0.08, dt);
        p.life -= dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const t of this.texts) { t.y -= 35 * dt; t.life -= dt; }
      this.texts = this.texts.filter((t) => t.life > 0);
    }

    updateWave(dt) {
      if (this.wave > 5 || this.state !== "playing") return;
      if (this.spawned >= this.waveQuota && this.waveKills >= this.waveQuota && this.enemies.length === 0) {
        if (this.waveClearTimer <= 0) {
          this.waveClearTimer = 2.5;
          this.score += this.wave * 400;
          this.healPlayer(12, "wave-clear");
          this.announce("SECTOR CLEAR", `第 ${this.wave} 波已肃清`, "机体修复 12 点 · 准备下一轮");
        } else {
          this.waveClearTimer -= dt;
          if (this.waveClearTimer <= 0) this.nextWave();
        }
      }
    }

    update(dt) {
      this.elapsed += dt;
      this.updatePlayer(dt);
      this.updateSpawner(dt);
      this.updateEnemies(dt);
      this.updateArena(dt);
      this.updateHazards(dt);
      this.updateBullets(dt);
      this.updateGems(dt);
      this.updateEffects(dt);
      this.updateWave(dt);
      this.updateHUD();
    }

    updateHUD() {
      if (!this.player) return;
      const p = this.player;
      ui.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
      ui.hpFill.style.width = `${clamp(p.hp / p.maxHp * 100, 0, 100)}%`;
      ui.hpFill.style.background = p.hp / p.maxHp < 0.3 ? "#ff5f79" : "";
      ui.levelText.textContent = `等级 ${p.level}`;
      ui.xpText.textContent = `${Math.floor(p.xp)} / ${p.xpNext}`;
      ui.xpFill.style.width = `${clamp(p.xp / p.xpNext * 100, 0, 100)}%`;
      ui.waveLabel.textContent = `${this.arena === "foundry" ? "熔炉环线 · " : ""}${this.wave <= 5 ? `第 ${this.wave} 波 / 共 6 波` : "最终波 / 中枢核心"}`;
      ui.waveProgress.textContent = this.wave <= 5 ? `${Math.min(this.waveKills, this.waveQuota)} / ${this.waveQuota}` : "终止协议";
      ui.scoreText.textContent = formatScore(this.score);
      ui.timeText.textContent = formatTime(this.elapsed);
      for (const weapon of Object.keys(WEAPONS)) {
        $(`weapon${weapon[0].toUpperCase()}${weapon.slice(1)}`).classList.toggle("selected", p.weapon === weapon);
      }
      ui.chargeFill.style.width = `${p.weapon === "charge" ? clamp(p.charge / p.chargeMax * 100, 0, 100) : 0}%`;
      ui.aimAssistText.textContent = `H 瞄准辅助：${this.aimAssist ? "开" : "关"}`;
      const ready = p.dashCooldown <= 0;
      ui.dashText.textContent = ready ? "就绪" : `${p.dashCooldown.toFixed(1)} 秒`;
      const dashPercent = ready ? 100 : (1 - p.dashCooldown / p.dashMax) * 100;
      ui.dashRing.style.background = `conic-gradient(#57f5e3 ${dashPercent}%, #18313c 0)`;
      if (this.boss && !this.boss.dead) {
        ui.bossFill.style.width = `${Math.max(0, this.boss.hp / this.boss.maxHp * 100)}%`;
        ui.bossPhase.textContent = `PHASE 0${this.boss.phase}`;
      }
    }

    endGame(victory) {
      if (this.state === "gameover" || this.state === "victory") return;
      this.state = victory ? "victory" : "gameover";
      this.mouse.down = false;
      ui.touch.classList.add("hidden");
      ui.weaponHud.classList.add("hidden");
      ui.level.classList.add("hidden");
      ui.pause.classList.add("hidden");
      ui.end.classList.remove("hidden");
      $("endEyebrow").textContent = victory ? "DAWN PROTOCOL COMPLETE" : "SIGNAL LOST";
      $("endTitle").textContent = victory ? "黎明已至" : "守夜终止";
      $("endDesc").textContent = victory ? "中枢核心已关闭。星港迎来了新的黎明。" : "机体信号已消失，但星港仍会记得你。";
      $("finalScore").textContent = formatScore(this.score);
      $("finalKills").textContent = this.kills;
      $("finalLevel").textContent = this.player.level;
      $("finalTime").textContent = formatTime(this.elapsed);
      const isRecord = this.score > (this.best.score || 0);
      if (isRecord) this.best.score = Math.floor(this.score);
      this.best.wave = Math.max(this.best.wave || 0, this.wave);
      this.saveBest();
      $("newRecord").classList.toggle("hidden", !isRecord);
      this.updateBestUI();
    }

    drawBackground() {
      ctx.fillStyle = "#06101b";
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, 600);
      glow.addColorStop(0, "#102c3b");
      glow.addColorStop(0.55, "#081723");
      glow.addColorStop(1, "#040b13");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.strokeStyle = "#17303d";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.42;
      const grid = 64;
      for (let x = 0; x <= W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#2f6370";
      for (let x = 0; x <= W; x += grid * 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += grid * 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();

      for (const s of this.structures) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.strokeStyle = "#1b3540";
        ctx.globalAlpha = 0.35;
        ctx.strokeRect(-s.s / 2, -s.s / 2, s.s, s.s);
        ctx.beginPath(); ctx.moveTo(-s.s * 0.7, 0); ctx.lineTo(s.s * 0.7, 0); ctx.stroke();
        ctx.restore();
      }
      for (const s of this.stars) {
        ctx.globalAlpha = s.a * (0.7 + Math.sin(this.globalTime * 1.4 + s.phase) * 0.3);
        ctx.fillStyle = "#a0e6eb";
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      this.drawArena();
      ctx.strokeStyle = "#1f4553";
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, W - 20, H - 20);
      ctx.fillStyle = "#2e5a66";
      ctx.font = "10px monospace";
      ctx.fillText("SECTOR 07 // NIGHT WATCH", 26, H - 25);
      ctx.textAlign = "right";
      ctx.fillText("HARBOR DEFENSE NETWORK", W - 26, H - 25);
      ctx.textAlign = "left";
    }

    drawArena() {
      if (this.arena === "foundry") {
        for (const rect of this.obstacles || []) {
          ctx.fillStyle = "#111d27";
          ctx.strokeStyle = "#38525c";
          ctx.lineWidth = 2;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
          ctx.strokeStyle = "#223842";
          for (let y = rect.y + 12; y < rect.y + rect.h; y += 18) {
            ctx.beginPath(); ctx.moveTo(rect.x + 8, y); ctx.lineTo(rect.x + rect.w - 8, y); ctx.stroke();
          }
        }
        const h = this.arenaHazard;
        if (h && h.phase !== "idle") {
          const rect = this.arenaHazardRect();
          const active = h.phase === "active";
          ctx.fillStyle = active ? "#ff3e4f38" : "#ffc86616";
          ctx.strokeStyle = active ? "#ff6b65" : "#b98b4e";
          ctx.lineWidth = active ? 3 : 1;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
          ctx.fillStyle = active ? "#ff8b7c" : "#d6aa62";
          ctx.font = "11px monospace";
          ctx.textAlign = "center";
          ctx.fillText(active ? "THERMAL VENT // ACTIVE" : "THERMAL VENT // STAND BY", rect.x + rect.w / 2, rect.y + rect.h / 2);
          ctx.textAlign = "left";
        }
      }
      for (const h of this.hazards || []) {
        ctx.save();
        if (h.kind === "mine") {
          ctx.translate(h.x, h.y);
          ctx.fillStyle = h.arm > 0 ? "#745e3d" : "#ffc866";
          ctx.strokeStyle = "#ffe0a1";
          ctx.shadowColor = "#ffc866";
          ctx.shadowBlur = h.arm > 0 ? 3 : 12;
          ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.fill(); ctx.stroke();
          if (h.arm <= 0) {
            ctx.globalAlpha = 0.25 + Math.sin(this.globalTime * 8) * 0.1;
            ctx.beginPath(); ctx.arc(0, 0, h.triggerRadius, 0, TAU); ctx.stroke();
          }
        } else if (h.kind === "blast") {
          const progress = 1 - h.timer / h.maxTime;
          ctx.fillStyle = `rgba(255,65,90,${0.08 + progress * 0.18})`;
          ctx.strokeStyle = "#ff6b82";
          ctx.lineWidth = 2 + progress * 3;
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r * progress, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
      for (const e of this.enemies || []) {
        if (e.type === "boss" && e.pendingAttack) {
          ctx.save();
          ctx.strokeStyle = "#ffcf78";
          ctx.globalAlpha = 0.45 + Math.sin(this.globalTime * 20) * 0.2;
          ctx.lineWidth = 2;
          ctx.setLineDash([12, 10]);
          ctx.beginPath(); ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(e.pendingAttack.angle) * 1400, e.y + Math.sin(e.pendingAttack.angle) * 1400);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    drawPlayer() {
      const p = this.player;
      if (!p || (this.state === "gameover" && p.hp <= 0)) return;
      if (p.invuln > 0 && Math.floor(this.globalTime * 18) % 2 === 0 && p.dashTime <= 0) ctx.globalAlpha = 0.35;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.shadowColor = "#57f5e3";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#72f9e8";
      ctx.beginPath();
      ctx.moveTo(25, 0); ctx.lineTo(-13, -13); ctx.lineTo(-7, 0); ctx.lineTo(-13, 13); ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0b3942";
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -6); ctx.lineTo(-4, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#d7fffa";
      ctx.fillRect(6, -2, 11, 4);
      ctx.fillStyle = "#27aeb3";
      ctx.fillRect(-15, -12, 7, 5);
      ctx.fillRect(-15, 7, 7, 5);
      ctx.restore();
      ctx.globalAlpha = 1;
      if (p.invuln > 0 || p.dashTime > 0) {
        ctx.strokeStyle = `rgba(100,255,235,${0.25 + Math.sin(this.globalTime * 20) * 0.15})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, TAU); ctx.stroke();
      }
      if (p.weapon === "charge" && p.charge > 0) {
        const ratio = clamp(p.charge / p.chargeMax, 0, 1);
        ctx.strokeStyle = ratio >= 1 ? "#fff0a8" : "#a9b8ff";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 29, -Math.PI / 2, -Math.PI / 2 + TAU * ratio); ctx.stroke();
      }
    }

    drawEnemy(e) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle + (e.type === "boss" ? this.globalTime * 0.25 : 0));
      const flash = e.flash > 0;
      if (e.type === "chaser" || e.type === "minion") {
        ctx.shadowColor = "#ff5f6d"; ctx.shadowBlur = 12;
        ctx.fillStyle = flash ? "#ffffff" : e.type === "minion" ? "#e77991" : "#f05e70";
        ctx.beginPath(); ctx.moveTo(e.r + 5, 0); ctx.lineTo(-e.r, -e.r * 0.75); ctx.lineTo(-e.r * 0.5, 0); ctx.lineTo(-e.r, e.r * 0.75); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#521b2a"; ctx.fillRect(-4, -3, 10, 6);
      } else if (e.type === "shooter") {
        ctx.shadowColor = "#b879ff"; ctx.shadowBlur = 14;
        ctx.fillStyle = flash ? "#ffffff" : "#aa6bdd";
        ctx.rotate(this.globalTime * 0.6);
        ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(0, -e.r); ctx.lineTo(-e.r - 4, 0); ctx.lineTo(0, e.r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#251540"; ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = "#e4b8ff"; ctx.fillRect(4, -2, 10, 4);
      } else if (e.type === "tank") {
        ctx.shadowColor = "#ff9d55"; ctx.shadowBlur = 12;
        ctx.fillStyle = flash ? "#ffffff" : "#c77a43";
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const x = Math.cos(a) * e.r; const y = Math.sin(a) * e.r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#ffc184"; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = "#4a2b27"; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
      } else if (e.type === "shielder") {
        ctx.shadowColor = "#64aaff"; ctx.shadowBlur = 14;
        ctx.fillStyle = flash ? "#ffffff" : "#497ab6";
        ctx.fillRect(-e.r * 0.72, -e.r * 0.72, e.r * 1.44, e.r * 1.44);
        ctx.strokeStyle = "#a4d5ff"; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 7, -1.08, 1.08); ctx.stroke();
        ctx.fillStyle = "#172e4b"; ctx.fillRect(-7, -7, 14, 14);
      } else if (e.type === "miner") {
        ctx.shadowColor = "#ffc866"; ctx.shadowBlur = 13;
        ctx.fillStyle = flash ? "#ffffff" : "#ba8d46";
        ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(0, -e.r); ctx.lineTo(-e.r, 0); ctx.lineTo(0, e.r); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#ffe0a0"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-e.r - 6, -10); ctx.lineTo(-e.r - 6, 10); ctx.stroke();
        ctx.fillStyle = "#3c2d1b"; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      } else if (e.type === "boss") {
        ctx.shadowColor = "#ff4f70"; ctx.shadowBlur = 25;
        ctx.strokeStyle = flash ? "#ffffff" : "#ff617b";
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(0, 0, 52, 0.2, 1.8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 52, Math.PI + 0.2, Math.PI + 1.8); ctx.stroke();
        ctx.rotate(-this.globalTime * 0.9);
        ctx.strokeStyle = "#9a3f62"; ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8; const x = Math.cos(a) * 40; const y = Math.sin(a) * 40; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = flash ? "#ffffff" : e.phase === 2 ? "#ff345c" : "#b52f55";
        ctx.beginPath(); ctx.arc(0, 0, 24 + Math.sin(this.globalTime * 4) * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = "#ffd4da"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (e.type !== "boss" && e.hp < e.maxHp) {
        const width = e.r * 2;
        ctx.fillStyle = "#25141c"; ctx.fillRect(e.x - width / 2, e.y - e.r - 10, width, 3);
        ctx.fillStyle = "#ff6d7c"; ctx.fillRect(e.x - width / 2, e.y - e.r - 10, width * Math.max(0, e.hp / e.maxHp), 3);
      }
    }

    drawBullets() {
      for (const b of this.bullets) {
        ctx.save();
        ctx.strokeStyle = b.friendly ? (b.critical ? "#ffd76b" : WEAPONS[b.weapon] ? WEAPONS[b.weapon].color : "#8affed") : "#ff6b91";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 12;
        ctx.lineWidth = b.r * 1.2;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.65, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    drawGems() {
      for (const g of this.gems) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.phase);
        ctx.shadowColor = "#5b9fff"; ctx.shadowBlur = 12;
        ctx.fillStyle = "#73b7ff";
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    drawEffects() {
      for (const p of this.particles) {
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = alpha * (p.ghost ? 0.22 : 0.85);
        ctx.fillStyle = p.color;
        if (p.ghost) { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, TAU); ctx.fill(); }
        else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      for (const t of this.texts) {
        ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
        ctx.fillStyle = t.color;
        ctx.font = `600 ${t.size}px Segoe UI, sans-serif`;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }

    drawMenuAmbient() {
      ctx.save();
      ctx.translate(W * 0.76, H * 0.47);
      ctx.rotate(this.globalTime * 0.08);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(70,190,190,${0.13 - i * 0.025})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 105 + i * 48, 0, TAU); ctx.stroke();
      }
      ctx.rotate(-this.globalTime * 0.25);
      ctx.shadowColor = "#57f5e3"; ctx.shadowBlur = 30;
      ctx.fillStyle = "#57f5e3";
      ctx.beginPath(); ctx.moveTo(52, 0); ctx.lineTo(-28, -28); ctx.lineTo(-12, 0); ctx.lineTo(-28, 28); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    render() {
      this.drawBackground();
      if (this.state === "menu") {
        this.drawMenuAmbient();
        return;
      }
      this.drawGems();
      for (const e of this.enemies) this.drawEnemy(e);
      this.drawBullets();
      this.drawPlayer();
      this.drawEffects();
      if (this.state === "paused" || this.state === "levelup") {
        ctx.fillStyle = "#02081055"; ctx.fillRect(0, 0, W, H);
      }
    }

    loop(time) {
      const dt = Math.min(0.033, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      try {
        this.globalTime += dt;
        if (this.state === "playing") this.update(dt);
        this.render();
      } catch (error) {
        // 单帧异常绝不能打断 rAF 链，否则整个游戏会静止成"什么都没有"。
        this.frameErrors += 1;
        if (this.frameErrors === 1) console.error("[星港守夜人] 单帧异常，主循环已继续：", error);
      } finally {
        requestAnimationFrame((t) => this.loop(t));
      }
    }
  }

  window.neonHarbor = new Game();
})();
