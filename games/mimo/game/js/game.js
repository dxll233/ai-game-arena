'use strict';

/* ============ 核心游戏类：状态机 / 主逻辑 / 渲染 ============ */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = CONFIG.W;
    this.H = CONFIG.H;

    this.keys = {};
    this.state = 'title';
    this.animTime = 0;
    this.shake = 0;
    this.damageFlash = 0;
    this.particleCap = 500;
    this.frameTimes = [];

    this.save = this.loadSave();
    AudioSys.muted = !!this.save.muted;

    /* 背景雾团 */
    this.mist = [];
    for (let i = 0; i < 7; i++) {
      this.mist.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        r: 120 + Math.random() * 180,
        phase: Math.random() * 10,
        speed: 6 + Math.random() * 10,
      });
    }

    this.reset();
    this.bindInput();
    this.bindUI();
    this.updateMuteFlag();
    this.showScreen('title-screen');
    document.getElementById('hud').classList.add('hidden');
  }

  /* ---------- 存档 ---------- */

  loadSave() {
    const def = { bestScore: 0, bestTime: 0, bestLevel: 0, totalKills: 0, totalRuns: 0, muted: false };
    try {
      const raw = localStorage.getItem('nightwatcher_save_v1');
      if (raw) return Object.assign(def, JSON.parse(raw));
    } catch (e) { /* 隐私模式等场景静默回退 */ }
    return def;
  }

  writeSave() {
    try {
      localStorage.setItem('nightwatcher_save_v1', JSON.stringify(this.save));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 世界初始化 ---------- */

  reset() {
    this.time = 0;
    this.kills = 0;
    this.score = 0;
    this.victoryShown = false;
    this.endless = false;
    this.settled = false;
    this.pendingLevelUps = 0;
    this.spawnTimer = 0.8;
    this.eliteTimer = CONFIG.spawn.eliteEvery;
    this.nextBossTime = CONFIG.spawn.bossFirst;
    this.enemies = [];
    this.bullets = [];
    this.gems = [];
    this.particles = [];
    this.floaters = [];
    this.zones = [];      /* 持续区域（墨幕 / 地面墨痕） */
    this.pendings = [];   /* 延迟事件（霆印爆轰 / 墨痕落点） */
    this.player = new Player();
    this.shake = 0;
    this.damageFlash = 0;
    this.currentCards = [];
  }

  /* ---------- UI 绑定 ---------- */

  bindUI() {
    const el = id => document.getElementById(id);
    el('start-btn').addEventListener('click', () => { AudioSys.init(); this.start(); });
    el('again-btn').addEventListener('click', () => { AudioSys.init(); this.start(); });
    el('end-btn').addEventListener('click', () => { AudioSys.click(); this.gameOver(true); });
    el('endless-btn').addEventListener('click', () => { AudioSys.click(); this.continueEndless(); });
    el('resume-btn').addEventListener('click', () => { AudioSys.click(); this.togglePause(); });
    el('restart-btn').addEventListener('click', () => { AudioSys.click(); this.start(); });
    el('mute-btn').addEventListener('click', () => this.toggleMute());
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 2 && this.state === 'playing') this.tryDash();
    });
  }

  bindInput() {
    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) {
        e.preventDefault();
      }
      this.keys[e.code] = true;
      if (e.repeat) return;

      if (e.code === 'KeyM') { this.toggleMute(); return; }

      switch (this.state) {
        case 'title':
          if (e.code === 'Enter' || e.code === 'Space') { AudioSys.init(); this.start(); }
          break;
        case 'playing':
          if (e.code === 'Space') this.tryDash();
          else if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
          break;
        case 'paused':
          if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter') this.togglePause();
          break;
        case 'levelup':
          if (e.code === 'Digit1') this.pickCard(0);
          else if (e.code === 'Digit2') this.pickCard(1);
          else if (e.code === 'Digit3') this.pickCard(2);
          break;
        case 'victory':
          if (e.code === 'Enter') this.continueEndless();
          else if (e.code === 'KeyE') this.gameOver(true);
          break;
        case 'gameover':
          if (e.code === 'Enter') this.start();
          break;
      }
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => {
      this.clearInput();
      if (this.state === 'playing') this.togglePause();
    });
    /* 页面隐藏（切标签页/最小化）与 blur 同等处理 */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clearInput();
        if (this.state === 'playing') this.togglePause();
      }
    });
  }

  /* 清空全部持续输入（按键、冲刺），防止丢失 keyup 后持续移动 */
  clearInput() {
    this.keys = {};
    const p = this.player;
    if (p) p.dashTimer = 0;
  }

  showScreen(id) {
    const screens = document.querySelectorAll('.screen');
    for (const s of screens) s.classList.add('hidden');
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  /* ---------- 状态切换 ---------- */

  start() {
    AudioSys.init();
    this.clearInput(); /* 开始新局前再次清空输入 */
    this.reset();
    this.state = 'playing';
    this.showScreen(null);
    document.getElementById('hud').classList.remove('hidden');
    AudioSys.start();
    this.updateHUD();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.clearInput(); /* 暂停时清空持续输入，恢复后只接受新按下 */
      this.showScreen('pause-screen');
      AudioSys.click();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.clearInput();
      this.showScreen(null);
      AudioSys.click();
    }
  }

  toggleMute() {
    AudioSys.muted = !AudioSys.muted;
    this.save.muted = AudioSys.muted;
    this.writeSave();
    this.updateMuteFlag();
    if (!AudioSys.muted) { AudioSys.init(); AudioSys.click(); }
  }

  updateMuteFlag() {
    document.getElementById('mute-flag').classList.toggle('hidden', !AudioSys.muted);
  }

  tryDash() {
    const p = this.player;
    if (p.dashCdTimer > 0 || p.dashTimer > 0) return;
    p.dashTimer = CONFIG.dash.dur;
    p.dashCdTimer = CONFIG.dash.cd;
    this.spawnInk(p.x, p.y, 10);
    AudioSys.dash();
  }

  /* ---------- 主更新 ---------- */

  update(dt) {
    this.animTime += dt;

    /* 自适应粒子上限 */
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (avg > 0.022 && this.particleCap > 200) {
        this.particleCap = Math.max(200, (this.particleCap * 0.7) | 0);
      }
    }

    if (this.state !== 'playing') return;

    this.time += dt;

    /* 胜利判定：本帧最优先执行，胜利与死亡不会同帧发生（结算互斥） */
    if (this.time >= CONFIG.winTime && !this.victoryShown) {
      this.victoryShown = true;
      this.showVictory();
      return;
    }

    const p = this.player;

    /* 移动 */
    let mx = 0, my = 0;
    const k = this.keys;
    if (k['KeyW'] || k['ArrowUp']) my -= 1;
    if (k['KeyS'] || k['ArrowDown']) my += 1;
    if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0) {
      mx /= len; my /= len;
      p.facing = Math.atan2(my, mx);
    }
    const dashing = p.dashTimer > 0;
    /* 墨幕区域减速 */
    let zoneSlow = 1;
    for (const z of this.zones) {
      if (z.slow < zoneSlow && dist2(p.x, p.y, z.x, z.y) < z.r * z.r) zoneSlow = z.slow;
    }
    const speed = p.speed * p.stats.speedMult * zoneSlow * (dashing ? CONFIG.dash.mult : 1);
    p.x = clamp(p.x + mx * speed * dt, p.r, this.W - p.r);
    p.y = clamp(p.y + my * speed * dt, p.r, this.H - p.r);

    /* 计时器 */
    p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.dashCdTimer = Math.max(0, p.dashCdTimer - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p.stats.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);

    /* 拖尾 */
    p.trailAcc += dt;
    if ((len > 0 || dashing) && p.trailAcc > 0.03) {
      p.trailAcc = 0;
      p.trail.push({ x: p.x, y: p.y, life: 0.35 });
      if (p.trail.length > 14) p.trail.shift();
    }
    for (const t of p.trail) t.life -= dt;
    p.trail = p.trail.filter(t => t.life > 0);

    Weapons.update(this, dt);
    this.updateSpawner(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateGems(dt);
    this.updateZones(dt);
    this.updatePendings(dt);
    this.updateParticles(dt);
    this.updateFloaters(dt);
    this.separate();

    this.shake = Math.max(0, this.shake - dt * 26);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);

    this.updateHUD();
  }

  /* ---------- 持续区域 / 延迟事件 ---------- */

  updateZones(dt) {
    const p = this.player;
    for (const z of this.zones) {
      z.update(dt);
      if (z.harm > 0 && !z.dead && dist2(p.x, p.y, z.x, z.y) < z.r * z.r) {
        if (z.tickTimer <= 0) {
          z.tickTimer = CONFIG.zone.tick;
          this.damagePlayer(z.harm, null);
        }
      }
    }
    this.zones = this.zones.filter(z => !z.dead);
  }

  updatePendings(dt) {
    for (const q of this.pendings) {
      if (q.dead) continue;
      q.t += dt;
      if (q.t < q.dur) continue;
      q.dead = true;
      if (q.kind === 'thunder2') {
        /* 连霆二次爆轰 */
        this.spawnRing(q.x, q.y, q.r, '#ffb347');
        this.spawnLightning(q.x, q.y);
        const r2 = q.r * q.r;
        for (const other of this.enemies) {
          if (!other.dead && dist2(q.x, q.y, other.x, other.y) < r2) {
            damageEnemy(this, other, q.dmg);
          }
        }
        AudioSys.thunder();
      } else if (q.kind === 'pool') {
        /* 墨君二阶段地面墨痕 */
        this.zones.push(new Zone(q.x, q.y, CONFIG.boss2.poolR, CONFIG.boss2.poolDur, {
          harm: CONFIG.boss2.poolDmg, slow: 1, color: '#6e2230',
        }));
      }
    }
    this.pendings = this.pendings.filter(q => !q.dead);
  }

  /* ---------- 刷怪 ---------- */

  updateSpawner(dt) {
    const s = CONFIG.spawn;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemies.length < s.maxAlive) {
      this.spawnTimer = Math.max(s.minInterval, s.baseInterval - this.time / s.intervalDecay);
      const count = s.perWave(this.time);
      for (let i = 0; i < count; i++) this.spawnEnemy(this.randomEnemyType(), false);
    }

    if (this.time >= s.eliteFrom) {
      this.eliteTimer -= dt;
      if (this.eliteTimer <= 0) {
        this.eliteTimer = s.eliteEvery;
        const n = 3 + ((Math.random() * 3) | 0);
        this.showBanner('精英墨影来袭', '#ff8a3c');
        for (let i = 0; i < n; i++) this.spawnEnemy(this.randomEnemyType(), true);
      }
    }

    if (this.time >= this.nextBossTime) {
      this.nextBossTime += s.bossEvery;
      this.spawnEnemy('boss', false);
      this.showBanner('墨君降临！', '#ff5a5a');
      this.shake = 12;
      AudioSys.boss();
    }
  }

  randomEnemyType() {
    /* 刷怪池：所有非 Boss 敌人按 unlock 时间与权重进入
     *（修复：旧版硬编码遗漏裂锋客/墨幕使者，新敌人永远无法自然生成） */
    const pool = [];
    for (const key in CONFIG.enemies) {
      const def = CONFIG.enemies[key];
      if (def.boss || def.weight <= 0) continue;
      if (this.time >= def.unlock) pool.push([key, def.weight]);
    }
    let total = 0;
    for (const e of pool) total += e[1];
    let r = Math.random() * total;
    for (const e of pool) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return 'mote';
  }

  spawnEnemy(type, elite) {
    const margin = 50;
    const side = (Math.random() * 4) | 0;
    let x, y;
    if (side === 0) { x = Math.random() * this.W; y = -margin; }
    else if (side === 1) { x = this.W + margin; y = Math.random() * this.H; }
    else if (side === 2) { x = Math.random() * this.W; y = this.H + margin; }
    else { x = -margin; y = Math.random() * this.H; }

    const scale = {
      hp: CONFIG.scaling.hp(this.time),
      speed: CONFIG.scaling.speed(this.time),
      dmg: CONFIG.scaling.dmg(this.time),
    };
    this.enemies.push(new Enemy(type, x, y, scale, elite));
  }

  /* ---------- 敌人行为 ---------- */

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.slowTimer = Math.max(0, e.slowTimer - dt);

      /* 灼烧（焚墨环）持续伤害 */
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          damageEnemy(this, e, e.burnDps * 0.5);
          if (e.dead) continue;
        }
      }

      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      e.dirX = ux; e.dirY = uy;

      const sp = e.speed * (e.slowTimer > 0 ? CONFIG.frost.slow : 1);

      if (e.boss) {
        /* Boss 两阶段：生命低于阈值进入二阶段（仅一次） */
        if (e.phase === 1 && !e.phase2Done && e.hp <= e.maxHp * CONFIG.boss2.phase2HpFrac) {
          this.enterBossPhase2(e);
        }
        const sp2 = sp * (e.phase === 2 ? CONFIG.boss2.phase2SpeedMult : 1);
        e.x += ux * sp2 * dt;
        e.y += uy * sp2 * dt;
        if (e.phase === 1) {
          e.shootTimer -= dt;
          if (e.shootTimer <= 0 && d < 900) {
            e.shootTimer = CONFIG.boss2.ringEvery;
            this.bossRing(e);
          }
        } else {
          /* 二阶段：扇形墨弹 + 地面墨痕（各有预警与走位窗口） */
          e.fanTimer -= dt;
          if (e.fanTimer <= 0 && d < 900) {
            e.fanTimer = CONFIG.boss2.fanEvery;
            this.bossFan(e);
          }
          e.poolTimer -= dt;
          if (e.poolTimer <= 0 && d < 900) {
            e.poolTimer = CONFIG.boss2.poolEvery;
            /* 墨痕落点预警（延迟生成伤害区） */
            this.pendings.push({
              x: clamp(p.x + rand(-50, 50), 60, this.W - 60),
              y: clamp(p.y + rand(-50, 50), 60, this.H - 60),
              t: 0, dur: CONFIG.boss2.poolTelegraph, kind: 'pool', dead: false,
            });
          }
        }
      } else if (e.lancer) {
        /* 裂锋客：接近 → 蓄力预警（方向锁定）→ 直线冲刺 → 硬直 */
        const L = CONFIG.lancer;
        if (e.aiState === 'chase') {
          e.x += ux * sp * dt;
          e.y += uy * sp * dt;
          if (d < L.engageDist) {
            e.aiState = 'aim';
            e.aiTimer = L.aimTime;
            e.aimX = ux; e.aimY = uy; /* 蓄力开始时锁定冲刺方向 */
          }
        } else if (e.aiState === 'aim') {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'dash';
            e.aiTimer = L.dashTime;
            AudioSys.dash();
          }
        } else if (e.aiState === 'dash') {
          e.aiTimer -= dt;
          e.x += e.aimX * L.dashSpeed * dt;
          e.y += e.aimY * L.dashSpeed * dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'recover';
            e.aiTimer = L.recoverTime;
          }
        } else {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) e.aiState = 'chase';
        }
      } else if (e.caster) {
        /* 墨幕使者：保持距离，蓄力后在预警点落下墨幕 */
        const V = CONFIG.veil;
        if (e.aiState === 'chase') {
          if (d > V.keepDist) {
            e.x += ux * sp * dt;
            e.y += uy * sp * dt;
          } else if (d < V.keepDist * 0.7) {
            e.x -= ux * sp * 0.7 * dt;
            e.y -= uy * sp * 0.7 * dt;
          } else {
            e.x += -uy * sp * 0.5 * dt;
            e.y += ux * sp * 0.5 * dt;
          }
          e.castTimer -= dt;
          if (e.castTimer <= 0) {
            e.castTimer = V.castEvery;
            e.aiState = 'cast';
            e.aiTimer = V.castTime;
            e.castX = clamp(p.x + rand(-40, 40), 50, this.W - 50);
            e.castY = clamp(p.y + rand(-40, 40), 50, this.H - 50);
          }
        } else {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'chase';
            this.zones.push(new Zone(e.castX, e.castY, V.zoneR, V.zoneDur, {
              owner: e, slow: V.zoneSlow, color: '#223844',
            }));
          }
        }
      } else if (e.ranged) {
        if (d > 300) {
          e.x += ux * sp * dt;
          e.y += uy * sp * dt;
        } else if (d < 180) {
          e.x -= ux * sp * dt;
          e.y -= uy * sp * dt;
        } else {
          e.x += -uy * sp * 0.8 * dt;
          e.y += ux * sp * 0.8 * dt;
        }
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && d < 640) {
          e.shootTimer = 2.2;
          const a = Math.atan2(dy, dx);
          this.bullets.push(new Bullet(
            e.x, e.y, Math.cos(a) * 260, Math.sin(a) * 260,
            7, e.dmg, false, { life: 3.2, color: '#d76a9f' }
          ));
          AudioSys.enemyShoot();
        }
      } else {
        e.x += ux * sp * dt;
        e.y += uy * sp * dt;
      }

      e.x = clamp(e.x, -160, this.W + 160);
      e.y = clamp(e.y, -160, this.H + 160);

      /* 接触伤害（裂锋客冲刺中倍率提升） */
      const rr = e.r + p.r;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr && p.invulnTimer <= 0 && p.dashTimer <= 0) {
        const hit = (e.lancer && e.aiState === 'dash') ? e.dmg * CONFIG.lancer.dashDmgMult : e.dmg;
        this.damagePlayer(hit, e);
      }
    }
  }

  bossRing(e) {
    const n = 12;
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      this.bullets.push(new Bullet(
        e.x, e.y, Math.cos(a) * 210, Math.sin(a) * 210,
        9, e.dmg * 0.55, false, { life: 4.2, color: '#ff7ab0' }
      ));
    }
    this.shake = Math.max(this.shake, 6);
    AudioSys.bossShoot();
  }

  /* Boss 二阶段转换（仅触发一次） */
  enterBossPhase2(e) {
    e.phase = 2;
    e.phase2Done = true;
    this.showBanner('墨君·蚀相——第二阶段', '#ff4d3c');
    this.shake = 12;
    AudioSys.boss();
  }

  /* Boss 二阶段：扇形墨弹（瞄准玩家，留走位间隙） */
  bossFan(e) {
    const n = CONFIG.boss2.fanCount;
    const baseA = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    for (let i = 0; i < n; i++) {
      const a = baseA + (i - (n - 1) / 2) * 0.18;
      this.bullets.push(new Bullet(
        e.x, e.y,
        Math.cos(a) * CONFIG.boss2.fanSpeed, Math.sin(a) * CONFIG.boss2.fanSpeed,
        8, e.dmg * 0.5, false, { life: 4, color: '#e0455f' }
      ));
    }
    this.shake = Math.max(this.shake, 5);
    AudioSys.bossShoot();
  }

  /* ---------- 子弹 ---------- */

  updateBullets(dt) {
    const p = this.player;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.update(dt);
      if (b.x < -60 || b.x > this.W + 60 || b.y < -60 || b.y > this.H + 60) {
        b.dead = true;
        continue;
      }
      if (b.friendly) {
        for (const e of this.enemies) {
          if (e.dead || b.hitSet.has(e)) continue;
          const rr = b.r + e.r;
          if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
            b.hitSet.add(e);
            damageEnemy(this, e, b.dmg);
            if (b.pierce <= 0) { b.dead = true; break; }
            b.pierce--;
          }
        }
      } else if (p.invulnTimer <= 0 && p.dashTimer <= 0) {
        const rr = b.r + p.r;
        if (dist2(b.x, b.y, p.x, p.y) < rr * rr) {
          b.dead = true;
          this.damagePlayer(b.dmg, null);
        }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
    if (this.bullets.length > 200) {
      this.bullets.splice(0, this.bullets.length - 200);
    }
  }

  /* ---------- 星火 ---------- */

  updateGems(dt) {
    const p = this.player;
    const pr = p.pickupRadius * p.stats.pickupMult;
    for (const g of this.gems) {
      if (!g.magnet && dist2(g.x, g.y, p.x, p.y) < pr * pr) g.magnet = true;
      g.update(dt, p);
      const rr = p.r + g.r + 4;
      if (dist2(g.x, g.y, p.x, p.y) < rr * rr) {
        g.dead = true;
        this.collectGem(g);
      }
    }
    this.gems = this.gems.filter(g => !g.dead);
  }

  addGem(x, y, xp) {
    if (this.gems.length >= 400) {
      /* 超预算：合并进最旧的宝石，避免同屏过量 */
      const g = this.gems[0];
      g.xp += xp;
      g.r = Math.min(14, g.r + 0.2);
      return;
    }
    this.gems.push(new Gem(x, y, xp));
  }

  collectGem(g) {
    const p = this.player;
    const gain = Math.max(1, Math.round(g.xp * p.stats.xpMult));
    p.xp += gain;
    if (this.floaters.length < 100) {
      this.floaters.push(new Floater(p.x + rand(-10, 10), p.y - 26, '+' + gain + ' 星火', '#a3670a'));
    }
    AudioSys.pickup();

    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = CONFIG.xp.base + (p.level - 1) * CONFIG.xp.perLevel;
      this.pendingLevelUps++;
    }
    if (this.pendingLevelUps > 0 && this.state === 'playing') this.enterLevelUp();
  }

  /* ---------- 玩家受击 / 击杀 ---------- */

  damagePlayer(amount, from) {
    const p = this.player;
    if (p.invulnTimer > 0 || p.dashTimer > 0) return;
    p.hp -= amount;
    p.invulnTimer = CONFIG.player.invuln;
    p.hitFlash = 0.25;
    this.damageFlash = 1;
    this.shake = Math.max(this.shake, 8);
    AudioSys.hurt();
    this.floaters.push(new Floater(p.x, p.y - 28, '-' + Math.round(amount), '#ff6b6b'));

    if (from) {
      const dx = p.x - from.x, dy = p.y - from.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x = clamp(p.x + dx / d * 18, p.r, this.W - p.r);
      p.y = clamp(p.y + dy / d * 18, p.r, this.H - p.r);
    }
    if (p.hp <= 0) {
      p.hp = 0;
      this.gameOver();
    }
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.spawnInk(e.x, e.y, e.boss ? 40 : e.elite ? 14 : 6);
    this.addGem(e.x, e.y, e.xp);

    /* 反制：击杀墨幕使者即驱散其墨幕 */
    if (e.type === 'veil') {
      for (const z of this.zones) {
        if (z.owner === e) z.dead = true;
      }
    }

    if (e.boss) {
      this.shake = Math.max(this.shake, 14);
      this.showBanner('墨君陨落！', '#ffd166');
      AudioSys.bossDie();
      for (let i = 0; i < 3; i++) {
        this.addGem(e.x + rand(-34, 34), e.y + rand(-34, 34), 20);
      }
    } else if (e.elite) {
      AudioSys.eliteDie();
    } else {
      AudioSys.kill();
    }
    this.enemies = this.enemies.filter(en => !en.dead);
  }

  findNearestEnemy(x, y, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /* ---------- 粒子 / 飘字 ---------- */

  spawnInk(x, y, n) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= this.particleCap) return;
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 190);
      this.particles.push(new Particle(
        x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        rand(0.25, 0.6), rand(1.5, 4), '#2a241f', { drag: 2.2 }
      ));
    }
  }

  spawnRing(x, y, radius, color) {
    if (this.particles.length >= this.particleCap) return;
    this.particles.push(new Particle(
      x, y, 0, 0, 0.55, 10, color,
      { grow: (radius - 10) / 0.55, drag: 0, ring: true }
    ));
  }

  spawnLightning(x, y) {
    for (let i = 0; i < 8; i++) {
      if (this.particles.length >= this.particleCap) return;
      const t = i / 8;
      this.particles.push(new Particle(
        x + rand(-6, 6), y - 150 * (1 - t),
        rand(-30, 30), rand(120, 260),
        rand(0.18, 0.35), rand(2, 4.5), '#fff3c4', { drag: 1 }
      ));
    }
    this.particles.push(new Particle(x, y, 0, 0, 0.18, 26, '#ffe27a', { grow: 60, drag: 0 }));
  }

  updateParticles(dt) {
    for (const pt of this.particles) pt.update(dt);
    this.particles = this.particles.filter(pt => !pt.dead);
    if (this.particles.length > this.particleCap) {
      this.particles.splice(0, this.particles.length - this.particleCap);
    }
  }

  updateFloaters(dt) {
    for (const f of this.floaters) f.update(dt);
    this.floaters = this.floaters.filter(f => !f.dead);
    if (this.floaters.length > 120) {
      this.floaters.splice(0, this.floaters.length - 120);
    }
  }

  separate() {
    const es = this.enemies;
    const n = es.length;
    for (let i = 0; i < n; i++) {
      const a = es[i];
      if (a.boss) continue;
      for (let j = i + 1; j < n; j++) {
        const b = es[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 > min * min || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }

  /* ---------- 升级三选一 ---------- */

  enterLevelUp() {
    this.state = 'levelup';
    AudioSys.levelup();
    this.showScreen('levelup-screen');
    this.renderCards();
  }

  rollCards() {
    const p = this.player;
    const bag = [];
    for (const u of UPGRADE_POOL) {
      if (u.type === 'weapon') {
        const cur = p.weapons[u.id];
        if (cur >= 5) continue;
        bag.push({ u: u, weight: cur === 0 ? 3 : 1 });
      } else {
        const cur = p.upgrades[u.id] || 0;
        if (u.max && cur >= u.max) continue;
        bag.push({ u: u, weight: 1 });
      }
    }
    /* 武器满 5 级后，对应进化卡以高权重进入候选（每种限一次） */
    for (const ev of EVOLUTION_POOL) {
      if (p.weapons[ev.id] >= 5 && !p.evolved[ev.id]) {
        bag.push({ u: ev, weight: 4 });
      }
    }
    const cards = [];
    while (cards.length < 3 && bag.length > 0) {
      let total = 0;
      for (const e of bag) total += e.weight;
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < bag.length; idx++) {
        r -= bag[idx].weight;
        if (r <= 0) break;
      }
      if (idx >= bag.length) idx = bag.length - 1;
      cards.push(bag.splice(idx, 1)[0].u);
    }
    while (cards.length < 3) {
      cards.push(UPGRADE_POOL[UPGRADE_POOL.length - 1]); /* 急救兜底 */
    }
    return cards;
  }

  renderCards() {
    const cards = this.rollCards();
    this.currentCards = cards;
    const wrap = document.getElementById('cards');
    wrap.innerHTML = '';
    const p = this.player;
    cards.forEach((u, i) => {
      const div = document.createElement('div');
      div.className = 'card';
      let lvText;
      if (u.type === 'weapon') {
        const cur = p.weapons[u.id];
        lvText = cur === 0 ? '未拥有' : ('Lv ' + cur + ' → ' + (cur + 1));
      } else if (u.type === 'evolve') {
        lvText = '武器进化 · 仅此一次';
      } else {
        const cur = p.upgrades[u.id] || 0;
        lvText = '层数 ' + cur + (u.max ? ' / ' + u.max : '');
      }
      div.innerHTML =
        '<div class="card-key">' + (i + 1) + '</div>' +
        '<div class="card-icon">' + u.icon + '</div>' +
        '<div class="card-name">' + u.name + '</div>' +
        '<div class="card-lv">' + lvText + '</div>' +
        '<div class="card-desc">' + u.desc(p) + '</div>';
      div.addEventListener('click', () => this.pickCard(i));
      wrap.appendChild(div);
    });
  }

  pickCard(idx) {
    const u = this.currentCards[idx];
    if (!u) return;
    const p = this.player;
    if (u.type === 'weapon') {
      p.weapons[u.id] = Math.min(5, p.weapons[u.id] + 1);
    } else if (u.type === 'evolve') {
      p.evolved[u.id] = true;
      this.showBanner(u.name + ' · 武器进化！', '#ff8a3c');
    } else {
      p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
      u.apply(p, this);
    }
    AudioSys.click();
    this.pendingLevelUps--;
    if (this.pendingLevelUps > 0) {
      this.renderCards();
    } else {
      this.state = 'playing';
      this.showScreen(null);
      this.updateHUD();
    }
  }

  /* ---------- 结算（一次性） ---------- */

  /* 结算数据只写入一次：300 秒胜利时结算；无尽阶段的后续死亡不再重复写入 */
  settleRun() {
    if (this.settled) return;
    this.settled = true;
    const p = this.player;
    this.score = this.kills * CONFIG.score.kill
      + Math.floor(this.time) * CONFIG.score.time
      + p.level * CONFIG.score.level;
    const s = this.save;
    this.isRecord = this.score > s.bestScore;
    s.bestScore = Math.max(s.bestScore, this.score);
    s.bestTime = Math.max(s.bestTime, this.time);
    s.bestLevel = Math.max(s.bestLevel, p.level);
    s.totalKills += this.kills;
    s.totalRuns++;
    this.writeSave();
  }

  /* 300 秒达成 → 胜利结算态：展示数据并提供「结束本局 / 继续无尽」 */
  showVictory() {
    this.clearInput();
    this.settleRun();
    this.state = 'victory';
    AudioSys.victory();
    const p = this.player;
    document.getElementById('victory-stats').innerHTML =
      '<div class="stat-row"><span>守夜时长</span><b>' + fmtTime(this.time) + '</b></div>' +
      '<div class="stat-row"><span>击杀</span><b>' + this.kills + '</b></div>' +
      '<div class="stat-row"><span>等级</span><b>Lv ' + p.level + '</b></div>' +
      '<div class="stat-row"><span>本局得分</span><b>' + this.score + '</b></div>' +
      (this.isRecord ? '<div class="stat-row best"><span>★ 新纪录 ★</span><b></b></div>' : '');
    this.showScreen('victory-screen');
  }

  /* 胜利后继续无尽：不再重复结算、不重播胜利 */
  continueEndless() {
    this.clearInput();
    this.endless = true;
    this.state = 'playing';
    this.showScreen(null);
    this.showBanner('无尽模式 · 墨潮再起', '#ff9a3c');
    AudioSys.click();
    this.updateHUD();
  }

  /* 结束本局 / 死亡 → 统一结算界面；fromEnd=true 表示胜利后的主动结束 */
  gameOver(fromEnd) {
    if (this.state === 'gameover') return;
    this.clearInput();
    this.settleRun();
    const endlessRun = this.endless;
    this.state = 'gameover';
    if (!fromEnd) AudioSys.death();
    const p = this.player;
    const s = this.save;

    let title;
    if (this.victoryShown && endlessRun) title = '无尽失败 · 已守夜成功';
    else if (this.victoryShown) title = '守夜成功 · 长夜终结';
    else title = '长夜终结';
    document.getElementById('over-title').textContent = title;

    const rows =
      '<div class="stat-row"><span>存活时间</span><b>' + fmtTime(this.time) + '</b></div>' +
      '<div class="stat-row"><span>击杀</span><b>' + this.kills + '</b></div>' +
      '<div class="stat-row"><span>等级</span><b>Lv ' + p.level + '</b></div>' +
      '<div class="stat-row"><span>本局得分</span><b>' + this.score + '</b></div>' +
      (this.victoryShown
        ? '<div class="stat-row win"><span>守夜目标</span><b>300 秒达成 ✓</b></div>'
        : '') +
      '<div class="stat-row best"><span>历史最高分</span><b>' + s.bestScore + '</b></div>' +
      '<div class="stat-row best"><span>历史最长存活</span><b>' + fmtTime(s.bestTime) + '</b></div>';
    document.getElementById('over-stats').innerHTML = rows;
    document.getElementById('new-record').classList.toggle('hidden', !this.isRecord);
    this.showScreen('gameover-screen');
  }

  showBanner(text, color) {
    const b = document.getElementById('banner');
    b.textContent = text;
    b.style.color = color || '#ffd166';
    b.classList.remove('show');
    void b.offsetWidth; /* 重排以重启动画 */
    b.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.remove('show'), 2200);
  }

  /* ---------- HUD ---------- */

  updateHUD() {
    const p = this.player;
    const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
    const hpBar = document.getElementById('hp-bar');
    hpBar.style.width = (hpRatio * 100) + '%';
    hpBar.classList.toggle('low', hpRatio < 0.3);
    document.getElementById('hp-text').textContent =
      Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
    document.getElementById('timer').textContent = fmtTime(this.time);
    document.getElementById('kills').textContent = '击杀 ' + this.kills;
    document.getElementById('level-badge').textContent = 'Lv ' + p.level;
    document.getElementById('xp-bar').style.width =
      (clamp(p.xp / p.xpNext, 0, 1) * 100) + '%';

    const wrap = document.getElementById('weapon-icons');
    const parts = [];
    for (const key of ['orbit', 'bolt', 'thunder', 'aura', 'frost']) {
      const lv = p.weapons[key];
      if (lv > 0) {
        const evo = p.evolved[key] ? '<em>进</em>' : '';
        parts.push('<span class="wicon">' + CONFIG[key].name + '<i>' + lv + '</i>' + evo + '</span>');
      }
    }
    const html = parts.join('');
    if (wrap._cache !== html) {
      wrap._cache = html;
      wrap.innerHTML = html;
    }

    const bw = document.getElementById('boss-hp-wrap');
    let boss = null;
    for (const e of this.enemies) {
      if (e.boss && !e.dead) { boss = e; break; }
    }
    if (boss) {
      bw.classList.remove('hidden');
      document.getElementById('boss-hp-bar').style.width =
        (clamp(boss.hp / boss.maxHp, 0, 1) * 100) + '%';
    } else {
      bw.classList.add('hidden');
    }
  }

  /* ---------- 渲染 ---------- */

  render() {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0.1) {
      ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    }
    this.drawBackground();
    if (this.state === 'title') {
      this.drawTitleAmbient();
    } else {
      this.drawWorld();
    }
    ctx.restore();

    this.drawVignette();

    if (this.damageFlash > 0) {
      ctx.fillStyle = 'rgba(160, 20, 20, ' + (this.damageFlash * 0.28) + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  drawBackground() {
    const ctx = this.ctx;
    /* 宣纸底（一次性生成纹理） */
    if (!this._paper) {
      const c = document.createElement('canvas');
      c.width = this.W; c.height = this.H;
      const g = c.getContext('2d');
      g.fillStyle = '#eee2c6';
      g.fillRect(0, 0, this.W, this.H);
      for (let i = 0; i < 800; i++) {
        const x = Math.random() * this.W, y = Math.random() * this.H;
        g.strokeStyle = 'rgba(120, 92, 52, ' + (Math.random() * 0.05) + ')';
        g.lineWidth = Math.random() * 1.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + rand(-32, 32), y + rand(-8, 8));
        g.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const x = Math.random() * this.W, y = Math.random() * this.H, r = 130 + Math.random() * 190;
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, 'rgba(96, 74, 44, 0.055)');
        rg.addColorStop(1, 'rgba(96, 74, 44, 0)');
        g.fillStyle = rg;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      this._paper = c;
    }
    ctx.drawImage(this._paper, 0, 0);
    /* 流动淡墨云染（亮底上的浅墨层次，不压暗战场） */
    for (const m of this.mist) {
      const x = m.x + Math.sin(this.animTime * 0.12 + m.phase) * m.speed * 4;
      const y = m.y + Math.cos(this.animTime * 0.09 + m.phase) * m.speed * 3;
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.r);
      g.addColorStop(0, 'rgba(88, 68, 42, 0.05)');
      g.addColorStop(1, 'rgba(88, 68, 42, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawVignette() {
    const ctx = this.ctx;
    if (!this._vignette) {
      const g = ctx.createRadialGradient(
        this.W / 2, this.H / 2, this.H * 0.55,
        this.W / 2, this.H / 2, this.H * 1.02
      );
      g.addColorStop(0, 'rgba(80, 55, 25, 0)');
      g.addColorStop(1, 'rgba(80, 55, 25, 0.18)');
      this._vignette = g;
    }
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  drawWorld() {
    const ctx = this.ctx;
    const p = this.player;

    /* 墨潮光环 */
    if (p.weapons.aura > 0) {
      const lv = CONFIG.aura.levels[p.weapons.aura - 1];
      const pulse = 1 + Math.sin(this.animTime * 2.2) * 0.03;
      const r = lv.radius * pulse;
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.25, p.x, p.y, r);
      g.addColorStop(0, 'rgba(110, 80, 190, 0)');
      g.addColorStop(0.75, 'rgba(110, 80, 190, 0.10)');
      g.addColorStop(1, 'rgba(126, 96, 214, 0.24)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 有害地面墨痕（位于实体下方） */
    for (const z of this.zones) if (z.harm > 0) z.draw(ctx);
    /* 延迟事件预警（霆印 / 墨痕落点） */
    this.drawPendings();

    for (const g of this.gems) g.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    for (const e of this.enemies) if (!e.dead) e.draw(ctx, this.animTime);
    this.drawPlayer();
    /* 墨幕（遮蔽视线，位于实体上方；击杀施法者即驱散） */
    for (const z of this.zones) if (z.harm <= 0) z.draw(ctx);
    for (const pt of this.particles) pt.draw(ctx);
    for (const f of this.floaters) f.draw(ctx);
  }

  drawPendings() {
    const ctx = this.ctx;
    for (const q of this.pendings) {
      const prog = clamp(q.t / q.dur, 0, 1);
      if (q.kind === 'pool') {
        ctx.strokeStyle = 'rgba(180, 40, 50, ' + (0.35 + prog * 0.5) + ')';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, CONFIG.boss2.poolR * (0.5 + prog * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        /* 霆印 */
        ctx.strokeStyle = 'rgba(220, 140, 20, ' + (0.4 + prog * 0.55) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (0.4 + prog * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 6, q.y);
        ctx.lineTo(q.x + 6, q.y);
        ctx.moveTo(q.x, q.y - 6);
        ctx.lineTo(q.x, q.y + 6);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
  }

  drawPlayer() {
    const ctx = this.ctx;
    const p = this.player;

    /* 拖尾 */
    for (const t of p.trail) {
      ctx.globalAlpha = clamp(t.life / 0.35, 0, 1) * 0.22;
      ctx.fillStyle = '#ffcf7a';
      ctx.beginPath();
      ctx.arc(t.x, t.y, p.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 光晕 */
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 46);
    g.addColorStop(0, 'rgba(255, 200, 120, 0.5)');
    g.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 46, 0, Math.PI * 2);
    ctx.fill();

    /* 本体（受击无敌时闪烁） */
    const flicker = p.invulnTimer > 0 && Math.sin(this.animTime * 30) > 0;
    if (!flicker) {
      ctx.fillStyle = p.hitFlash > 0 ? '#ffffff' : '#ffd98f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      /* 深墨描边：亮宣纸底上保持玩家轮廓清晰 */
      ctx.strokeStyle = '#241a10';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#8a5a20';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 符火环绕 */
    if (p.weapons.orbit > 0) {
      const lv = CONFIG.orbit.levels[p.weapons.orbit - 1];
      ctx.strokeStyle = 'rgba(255, 170, 100, 0.12)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONFIG.orbit.radius, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < lv.count; i++) {
        const a = p.timers.orbitAngle + (i / lv.count) * Math.PI * 2;
        const ox = p.x + Math.cos(a) * CONFIG.orbit.radius;
        const oy = p.y + Math.sin(a) * CONFIG.orbit.radius;
        /* 火焰扫掠的径向轨迹 */
        ctx.strokeStyle = 'rgba(255, 170, 100, 0.12)';
        ctx.lineWidth = CONFIG.orbit.orbR * 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ox, oy);
        ctx.stroke();
        ctx.lineWidth = 1;
        const og = ctx.createRadialGradient(ox, oy, 1, ox, oy, 20);
        og.addColorStop(0, 'rgba(255, 160, 90, 0.9)');
        og.addColorStop(1, 'rgba(255, 120, 60, 0)');
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(ox, oy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffb066';
        ctx.beginPath();
        ctx.arc(ox, oy, CONFIG.orbit.orbR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawTitleAmbient() {
    const ctx = this.ctx;
    for (let i = 0; i < 12; i++) {
      const t = this.animTime * 0.3 + i * 1.7;
      const x = (Math.sin(t * 0.7 + i) * 0.5 + 0.5) * this.W;
      const y = ((i / 12 + this.animTime * 0.02 * (1 + i % 3)) % 1) * this.H;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#3a3229';
      ctx.beginPath();
      ctx.arc(x, y, 14 + (i % 4) * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(this.W / 2, this.H * 0.42, 10, this.W / 2, this.H * 0.42, 260);
    g.addColorStop(0, 'rgba(255, 190, 110, 0.18)');
    g.addColorStop(1, 'rgba(255, 190, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
  }
}
