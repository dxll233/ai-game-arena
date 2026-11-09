'use strict';

/* ============ 伤害统一入口 ============ */

function damageEnemy(game, enemy, amount) {
  if (enemy.dead) return;
  const dmg = amount * game.player.stats.dmgMult;
  enemy.hp -= dmg;
  enemy.hitFlash = 0.12;
  if (game.floaters.length < 120 && Math.random() < 0.7) {
    game.floaters.push(new Floater(
      enemy.x + rand(-8, 8), enemy.y - enemy.r - 4,
      String(Math.round(dmg)), '#8a3208'
    ));
  }
  game.spawnInk(enemy.x, enemy.y, 2);
  if (enemy.hp <= 0) game.killEnemy(enemy);
}

/* ============ 五种武器 ============ */

const Weapons = {
  update(game, dt) {
    const p = game.player;
    if (p.weapons.orbit > 0) Weapons.updateOrbit(game, dt);
    if (p.weapons.bolt > 0) Weapons.updateBolt(game, dt);
    if (p.weapons.thunder > 0) Weapons.updateThunder(game, dt);
    if (p.weapons.aura > 0) Weapons.updateAura(game, dt);
    if (p.weapons.frost > 0) Weapons.updateFrost(game, dt);
  },

  /* 符火：环绕火苗，沿半径径向扫掠（覆盖贴身敌人）；进化·焚墨环周期喷发火环 */
  updateOrbit(game, dt) {
    const p = game.player;
    const lv = CONFIG.orbit.levels[p.weapons.orbit - 1];
    p.timers.orbitAngle += CONFIG.orbit.angular * dt;
    const n = lv.count;
    for (const e of game.enemies) {
      if (e.dead) continue;
      e._orbitCd = Math.max(0, e._orbitCd - dt);
      if (e._orbitCd > 0) continue;
      for (let i = 0; i < n; i++) {
        const a = p.timers.orbitAngle + (i / n) * Math.PI * 2;
        const ox = p.x + Math.cos(a) * CONFIG.orbit.radius;
        const oy = p.y + Math.sin(a) * CONFIG.orbit.radius;
        const rr = CONFIG.orbit.orbR + e.r;
        if (distToSegment2(e.x, e.y, p.x, p.y, ox, oy) < rr * rr) {
          damageEnemy(game, e, lv.dmg);
          e._orbitCd = CONFIG.orbit.hitCd;
          break;
        }
      }
    }

    /* 进化·焚墨环：周期向外喷发火环，命中附加灼烧 */
    if (p.evolved.orbit) {
      p.timers.evoRing -= dt;
      if (p.timers.evoRing <= 0) {
        p.timers.evoRing = CONFIG.evolution.orbit.ringEvery * p.stats.cdMult;
        const eco = CONFIG.evolution.orbit;
        game.spawnRing(p.x, p.y, eco.ringRadius, '#ff7a2a');
        const r2 = eco.ringRadius * eco.ringRadius;
        for (const e of game.enemies) {
          if (e.dead) continue;
          if (dist2(p.x, p.y, e.x, e.y) < r2) {
            damageEnemy(game, e, lv.dmg * eco.dmgMult);
            e.burnTimer = eco.burnDur;
            e.burnDps = eco.burnDps;
          }
        }
        AudioSys.frost();
      }
    }
  },

  /* 飞星：自动瞄准弹幕；进化·贯星阵：无限穿透 + 每第 5 发五星贯阵 */
  updateBolt(game, dt) {
    const p = game.player;
    const lv = CONFIG.bolt.levels[p.weapons.bolt - 1];
    p.timers.bolt -= dt;
    if (p.timers.bolt > 0) return;
    p.timers.bolt = (1 / lv.rate) * p.stats.cdMult;
    const target = game.findNearestEnemy(p.x, p.y, CONFIG.bolt.range);
    if (!target) return;
    const baseA = Math.atan2(target.y - p.y, target.x - p.x);
    const evo = p.evolved.bolt;
    p.timers.boltShot++;

    if (evo && p.timers.boltShot % CONFIG.evolution.bolt.arrayEvery === 0) {
      /* 五星贯阵：宽扇面、无限穿透 */
      const ec = CONFIG.evolution.bolt;
      for (let i = 0; i < ec.arrayCount; i++) {
        const a = baseA + (i - (ec.arrayCount - 1) / 2) * ec.spread;
        game.bullets.push(new Bullet(
          p.x, p.y,
          Math.cos(a) * CONFIG.bolt.speed, Math.sin(a) * CONFIG.bolt.speed,
          CONFIG.bolt.r * 1.15, lv.dmg, true,
          { pierce: Infinity, life: 1.8, color: '#4fc9ff' }
        ));
      }
      AudioSys.thunder();
      return;
    }

    const spread = lv.count > 1 ? 0.16 : 0;
    for (let i = 0; i < lv.count; i++) {
      const a = baseA + (i - (lv.count - 1) / 2) * spread;
      game.bullets.push(new Bullet(
        p.x, p.y,
        Math.cos(a) * CONFIG.bolt.speed, Math.sin(a) * CONFIG.bolt.speed,
        CONFIG.bolt.r, lv.dmg, true,
        { pierce: evo ? Infinity : lv.pierce, life: 1.8, color: '#3fb4e8' }
      ));
    }
    AudioSys.shoot();
  },

  /* 雷印：随机落雷 + 连锁；进化·连霆：落雷处留下霆印，延迟二次爆轰 */
  updateThunder(game, dt) {
    const p = game.player;
    const lv = CONFIG.thunder.levels[p.weapons.thunder - 1];
    p.timers.thunder -= dt;
    if (p.timers.thunder > 0) return;
    p.timers.thunder = lv.interval * p.stats.cdMult;
    if (game.enemies.length === 0) return;

    const picked = [];
    let cur = game.enemies[(Math.random() * game.enemies.length) | 0];
    picked.push(cur);
    for (let c = 1; c < lv.chain; c++) {
      let best = null, bestD = 300 * 300;
      for (const e of game.enemies) {
        if (e.dead || picked.indexOf(e) >= 0) continue;
        const d = dist2(cur.x, cur.y, e.x, e.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) break;
      picked.push(best);
      cur = best;
    }

    for (const e of picked) {
      game.spawnRing(e.x, e.y, CONFIG.thunder.aoe, '#ffe27a');
      game.spawnLightning(e.x, e.y);
      const r2 = CONFIG.thunder.aoe * CONFIG.thunder.aoe;
      for (const other of game.enemies) {
        if (other.dead) continue;
        if (dist2(e.x, e.y, other.x, other.y) < r2) {
          damageEnemy(game, other, lv.dmg);
        }
      }
      /* 进化·连霆：霆印延迟爆轰 */
      if (p.evolved.thunder) {
        const et = CONFIG.evolution.thunder;
        game.pendings.push({
          x: e.x, y: e.y, t: 0, dur: et.detonateDelay,
          kind: 'thunder2', dmg: lv.dmg * et.dmgMult, r: et.radius, dead: false,
        });
      }
    }
    AudioSys.thunder();
  },

  /* 墨潮：身周持续光环 */
  updateAura(game, dt) {
    const p = game.player;
    const lv = CONFIG.aura.levels[p.weapons.aura - 1];
    p.timers.auraTick -= dt;
    if (p.timers.auraTick > 0) return;
    p.timers.auraTick = CONFIG.aura.tick * p.stats.cdMult;
    const r2 = lv.radius * lv.radius;
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (dist2(p.x, p.y, e.x, e.y) < r2) {
        damageEnemy(game, e, lv.dmg);
      }
    }
  },

  /* 冰棱：周期冰环 + 减速 */
  updateFrost(game, dt) {
    const p = game.player;
    const lv = CONFIG.frost.levels[p.weapons.frost - 1];
    p.timers.frost -= dt;
    if (p.timers.frost > 0) return;
    p.timers.frost = lv.interval * p.stats.cdMult;
    game.spawnRing(p.x, p.y, CONFIG.frost.radius, '#9fd8ff');
    const r2 = CONFIG.frost.radius * CONFIG.frost.radius;
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (dist2(p.x, p.y, e.x, e.y) < r2) {
        damageEnemy(game, e, lv.dmg);
        e.slowTimer = CONFIG.frost.slowDur;
      }
    }
    AudioSys.frost();
  },
};
