'use strict';

/* ============ 通用工具 ============ */

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

/* 点到线段距离的平方（用于环绕火苗的径向扫掠判定） */
function distToSegment2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}
function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ============ 粒子 ============ */

class Particle {
  constructor(x, y, vx, vy, life, size, color, opts) {
    opts = opts || {};
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color;
    this.drag = opts.drag !== undefined ? opts.drag : 1.5;
    this.grow = opts.grow || 0;
    this.ring = !!opts.ring;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const f = Math.max(0, 1 - this.drag * dt);
    this.vx *= f; this.vy *= f;
    this.size += this.grow * dt;
  }
  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1);
    if (this.ring) {
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1 + 4 * a;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(1, this.size), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ============ 飘字 ============ */

class Floater {
  constructor(x, y, text, color) {
    this.x = x; this.y = y;
    this.text = text;
    this.color = color || '#ffe2ad';
    this.life = 0.7; this.maxLife = 0.7;
    this.vy = -46;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.y += this.vy * dt;
    this.vy *= Math.max(0, 1 - 1.6 * dt);
  }
  draw(ctx) {
    ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.font = 'bold 15px "STKaiti","KaiTi","楷体",serif';
    ctx.textAlign = 'center';
    /* 亮底上用浅色描边保证飘字可读 */
    ctx.strokeStyle = 'rgba(250, 244, 230, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(this.text, this.x, this.y);
    ctx.lineWidth = 1;
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1;
  }
}

/* ============ 星火（经验宝石） ============ */

class Gem {
  constructor(x, y, xp) {
    this.x = x; this.y = y;
    this.xp = xp;
    this.r = xp >= 60 ? 14 : xp >= 15 ? 10 : xp >= 4 ? 7 : 5;
    const a = Math.random() * Math.PI * 2;
    const sp = rand(30, 90);
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.magnet = false;
    this.t = Math.random() * 10;
    this.color = xp >= 15 ? '#e8641c' : xp >= 4 ? '#e89a10' : '#d9b531';
    this.dead = false;
  }
  update(dt, player) {
    this.t += dt;
    if (this.magnet) {
      const dx = player.x - this.x, dy = player.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.x += dx / d * 480 * dt;
      this.y += dy / d * 480 * dt;
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= Math.max(0, 1 - 2.5 * dt);
      this.vy *= Math.max(0, 1 - 2.5 * dt);
    }
  }
  draw(ctx) {
    const bob = Math.sin(this.t * 3) * 1.5;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y + bob, this.r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y + bob, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 70, 10, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

/* ============ 子弹（friendly 区分敌我） ============ */

class Bullet {
  constructor(x, y, vx, vy, r, dmg, friendly, opts) {
    opts = opts || {};
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.r = r; this.dmg = dmg;
    this.friendly = friendly;
    this.pierce = opts.pierce || 0;
    this.life = opts.life || 2.2;
    this.color = opts.color || (friendly ? '#9be8ff' : '#e06a9f');
    this.hitSet = new Set();
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  draw(ctx) {
    /* 拖影 */
    const d = Math.hypot(this.vx, this.vy) || 1;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.r * 1.6;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx / d * this.r * 3, this.y - this.vy / d * this.r * 3);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    /* 深色描边 + 亮芯，保证亮底上敌我弹幕可辨 */
    ctx.strokeStyle = this.friendly ? 'rgba(20, 60, 90, 0.85)' : 'rgba(120, 15, 45, 0.9)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = this.friendly ? '#ffffff' : '#ffd7e2';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ============ 敌人 ============ */

class Enemy {
  constructor(type, x, y, scale, elite) {
    const base = CONFIG.enemies[type];
    this.type = type;
    this.name = base.name;
    this.elite = !!elite;
    this.boss = !!base.boss;
    this.maxHp = base.hp * scale.hp * (this.elite ? CONFIG.elite.hp : 1);
    this.hp = this.maxHp;
    this.speed = base.speed * scale.speed * (this.elite ? CONFIG.elite.speed : 1);
    this.dmg = base.dmg * scale.dmg * (this.elite ? CONFIG.elite.dmg : 1);
    this.r = base.r * (this.elite ? CONFIG.elite.r : 1);
    this.xp = Math.round(base.xp * (this.elite ? CONFIG.elite.xp : 1));
    this.x = x; this.y = y;
    this.color = base.color;
    this.ranged = !!base.ranged && !this.boss;
    this.lancer = type === 'lancer';  /* 裂锋客：蓄力冲刺 AI */
    this.caster = type === 'veil';    /* 墨幕使者：落点施法 AI */
    this.slowTimer = 0;
    this.hitFlash = 0;
    this.dirX = 1; this.dirY = 0;
    this.seed = Math.random() * 100;
    this.shootTimer = this.boss ? 3 : rand(1.2, 2.6);
    this._orbitCd = 0;

    /* 新敌人机制 / Boss 阶段状态 */
    this.aiState = 'chase';        /* lancer: chase/aim/dash/recover ｜ veil: chase/cast */
    this.aiTimer = 0;
    this.aimX = 0; this.aimY = 0;  /* 裂锋客冲刺方向（蓄力开始时锁定） */
    this.castX = 0; this.castY = 0;/* 墨幕落点（预警期间显示） */
    this.castTimer = CONFIG.veil.castEvery * rand(0.6, 1.2);
    this.burnTimer = 0; this.burnDps = 0; this.burnTick = 0;
    this.phase = this.boss ? 1 : 0;
    this.phase2Done = false;
    this.fanTimer = 2.2;
    this.poolTimer = 3.8;

    this.dead = false;
  }

  /* 分类型剪影路径（亮宣纸底上的高对比墨形） */
  traceShape(ctx, r) {
    const t = this.type;
    ctx.beginPath();
    if (t === 'dart') {
      /* 疾影：指向前方的长楔形 */
      const dx = this.dirX, dy = this.dirY, ex = -dy, ey = dx;
      ctx.moveTo(dx * r * 1.5, dy * r * 1.5);
      ctx.lineTo(ex * r * 0.85 - dx * r * 0.6, ey * r * 0.85 - dy * r * 0.6);
      ctx.lineTo(-dx * r * 0.25, -dy * r * 0.25);
      ctx.lineTo(-ex * r * 0.85 - dx * r * 0.6, -ey * r * 0.85 - dy * r * 0.6);
      ctx.closePath();
    } else if (t === 'spitter') {
      /* 墨刺：六角带尖刺 */
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.25 : r * 0.85;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (t === 'brute') {
      /* 磐石：厚重方圆 */
      const s = r * 0.92;
      ctx.moveTo(-s, -s * 0.75);
      ctx.lineTo(s, -s * 0.75);
      ctx.lineTo(s * 0.88, s * 0.85);
      ctx.lineTo(-s * 0.88, s * 0.85);
      ctx.closePath();
    } else if (t === 'lancer') {
      /* 裂锋客：菱形刃 */
      const dx = this.dirX, dy = this.dirY, ex = -dy, ey = dx;
      ctx.moveTo(dx * r * 1.35, dy * r * 1.35);
      ctx.lineTo(ex * r * 0.8, ey * r * 0.8);
      ctx.lineTo(-dx * r * 1.25, -dy * r * 1.25);
      ctx.lineTo(-ex * r * 0.8, -ey * r * 0.8);
      ctx.closePath();
    } else if (t === 'veil') {
      /* 墨幕使者：兜帽形 */
      ctx.arc(0, r * 0.15, r * 0.95, Math.PI * 0.92, Math.PI * 2.08);
      ctx.lineTo(r * 0.62, r * 0.9);
      ctx.lineTo(-r * 0.62, r * 0.9);
      ctx.closePath();
    } else if (t === 'boss') {
      /* 墨君：层叠墨轮 */
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else {
      /* 墨点：带墨滴起伏的圆 */
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const rr = r * (1 + Math.sin(a * 3 + this.seed) * 0.09);
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }

  draw(ctx, time) {
    const wobble = 1 + Math.sin(time * 2.2 + this.seed) * 0.07;
    const r = this.r * wobble;

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 裂锋客冲刺拖影 */
    if (this.type === 'lancer' && this.aiState === 'dash') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#a02f38';
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(-this.aimX * i * 13, -this.aimY * i * 13, r * (1 - i * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* 墨晕外圈 */
    const halo = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r * 1.7);
    halo.addColorStop(0, this.color);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 主体剪影 + 深墨描边（亮底辨识） */
    this.traceShape(ctx, r);
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(24, 18, 28, 0.9)';
    ctx.lineWidth = this.boss ? 3.5 : 2.2;
    ctx.stroke();
    ctx.lineWidth = 1;

    /* Boss 二阶段赤色相轮 */
    if (this.boss && this.phase === 2) {
      ctx.strokeStyle = 'rgba(200, 40, 60, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.22 + Math.sin(time * 4) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    /* 朝向玩家的双眼 */
    const dx = this.dirX, dy = this.dirY;
    const ex = -dy, ey = dx;
    const er = Math.max(1.8, r * 0.14);
    ctx.fillStyle = this.boss ? '#ff4d6d' : (this.elite ? '#ffb02e' : '#f2e8d5');
    ctx.beginPath();
    ctx.arc(dx * r * 0.32 + ex * r * 0.3, dy * r * 0.32 + ey * r * 0.3, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx * r * 0.32 - ex * r * 0.3, dy * r * 0.32 - ey * r * 0.3, er, 0, Math.PI * 2);
    ctx.fill();

    /* 精英金环 + 冠齿；Boss 玄环 */
    if (this.elite) {
      ctx.strokeStyle = 'rgba(216, 154, 30, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8a92c';
      for (let i = -1; i <= 1; i++) {
        const cx = i * r * 0.62, cy = -r * 1.12;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy + 7);
        ctx.lineTo(cx, cy - 3);
        ctx.lineTo(cx + 5, cy + 7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.lineWidth = 1;
    }

    /* 灼烧（焚墨环）标记 */
    if (this.burnTimer > 0) {
      ctx.fillStyle = 'rgba(255, 120, 40, 0.85)';
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + i * 2.1 + this.seed;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* 减速标记 */
    if (this.slowTimer > 0) {
      ctx.strokeStyle = 'rgba(70, 140, 220, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.restore();

    /* 裂锋客蓄力预警线（方向已锁定，横移可躲） */
    if (this.type === 'lancer' && this.aiState === 'aim') {
      const prog = 1 - this.aiTimer / CONFIG.lancer.aimTime;
      ctx.strokeStyle = 'rgba(200, 40, 50, ' + (0.35 + prog * 0.5) + ')';
      ctx.lineWidth = 2 + prog * 7;
      ctx.setLineDash([14, 9]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.aimX * 460, this.y + this.aimY * 460);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    /* 墨幕使者施法预警圈 */
    if (this.type === 'veil' && this.aiState === 'cast') {
      const prog = 1 - this.aiTimer / CONFIG.veil.castTime;
      ctx.strokeStyle = 'rgba(40, 86, 107, ' + (0.4 + prog * 0.5) + ')';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(this.castX, this.castY, CONFIG.veil.zoneR * (0.55 + prog * 0.45), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    /* 精英 / Boss 头顶血条 */
    if ((this.elite || this.boss) && this.hp < this.maxHp) {
      const w = this.r * 2;
      ctx.fillStyle = 'rgba(240, 230, 210, 0.85)';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 13, w, 5);
      ctx.fillStyle = this.boss ? '#c0284c' : '#d89220';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 13, w * clamp(this.hp / this.maxHp, 0, 1), 5);
    }
  }
}

/* ============ 玩家 ============ */

class Player {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = CONFIG.W / 2;
    this.y = CONFIG.H / 2;
    this.r = CONFIG.player.r;
    this.maxHp = CONFIG.player.maxHp;
    this.hp = this.maxHp;
    this.speed = CONFIG.player.speed;
    this.pickupRadius = CONFIG.player.pickup;
    this.level = 1;
    this.xp = 0;
    this.xpNext = CONFIG.xp.base;
    this.invulnTimer = 0;
    this.dashTimer = 0;
    this.dashCdTimer = 0;
    this.hitFlash = 0;
    this.facing = 0;
    this.trail = [];
    this.trailAcc = 0;
    this.stats = {
      dmgMult: 1,
      cdMult: 1,
      xpMult: 1,
      pickupMult: 1,
      speedMult: 1,
      regen: 0,
    };
    this.weapons = { orbit: 1, bolt: 0, thunder: 0, aura: 0, frost: 0 };
    this.evolved = { orbit: false, bolt: false, thunder: false };
    this.timers = {
      orbitAngle: 0, bolt: 0, thunder: 0, frost: 0, auraTick: 0,
      evoRing: CONFIG.evolution.orbit.ringEvery, boltShot: 0,
    };
    this.upgrades = {};
  }
}

/* ============ 区域（墨幕 / 地面墨痕等持续区域） ============ */

class Zone {
  constructor(x, y, r, dur, opts) {
    opts = opts || {};
    this.x = x; this.y = y; this.r = r;
    this.life = dur; this.maxLife = dur;
    this.owner = opts.owner || null;
    this.harm = opts.harm || 0;   /* 每跳对玩家伤害（0 = 不伤害） */
    this.slow = opts.slow || 1;   /* 玩家位于区域内时的移速倍率 */
    this.tickTimer = 0;
    this.color = opts.color || '#20323c';
    this.t = Math.random() * 10;
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (this.harm > 0) this.tickTimer -= dt;
  }
  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1);
    const wob = 1 + Math.sin(this.t * 1.8) * 0.04;
    const r = this.r * wob;
    /* 墨渍主体 */
    const g = ctx.createRadialGradient(this.x, this.y, r * 0.2, this.x, this.y, r);
    g.addColorStop(0, this.hexA(this.color, 0.62 * a + 0.18));
    g.addColorStop(0.82, this.hexA(this.color, 0.42 * a + 0.12));
    g.addColorStop(1, this.hexA(this.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    /* 不规则墨缘 */
    ctx.strokeStyle = this.hexA(this.color, 0.55 * a + 0.2);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.92, this.t * 0.4, this.t * 0.4 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    if (this.harm > 0) {
      /* 有害区域：危险色提示 */
      ctx.strokeStyle = this.hexA('#c0392b', 0.7);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 0.98, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
}
