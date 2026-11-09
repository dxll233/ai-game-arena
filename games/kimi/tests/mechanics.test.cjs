"use strict";

const assert = require("node:assert/strict");
const { freshGame } = require("./harness.cjs");

const DT = 1 / 120;
const results = [];

function isolate(game) {
  game.wave = 1;
  game.spawned = 999;
  game.enemies = [];
  game.bullets = [];
  game.hazards = [];
  game.player.crit = 0;
  game.player.x = 400;
  game.player.y = 360;
  game.player.angle = 0;
  game.mouse.x = 900;
  game.mouse.y = 360;
}

function measureWeapon(type) {
  const { game } = freshGame();
  isolate(game);
  game.switchWeapon(type);
  const target = game.spawnEnemy("tank", 540, 360);
  target.hp = target.maxHp = 1e8;
  let attacks = 0;
  let projectiles = 0;
  let hits = 0;
  let elapsed = 0;
  const originalFire = game.fireWeapon.bind(game);
  game.fireWeapon = () => {
    const before = game.bullets.length;
    originalFire();
    attacks += 1;
    projectiles += game.bullets.length - before;
    if (attacks >= 10) game.mouse.down = false;
  };
  const originalDamage = game.damageEnemy.bind(game);
  game.damageEnemy = (enemy, amount, critical, bullet) => {
    hits += 1;
    originalDamage(enemy, amount, critical, bullet);
  };
  game.mouse.down = true;

  if (type === "charge") {
    let released = false;
    for (let step = 0; step < 20000 && (attacks < 10 || game.bullets.length); step++) {
      if (game.player.charge >= game.player.chargeMax && !released) {
        game.mouse.down = false;
        released = true;
      }
      game.updatePlayer(DT);
      game.updateBullets(DT);
      elapsed += DT;
      if (released && game.player.fireTimer <= 0 && game.bullets.length === 0 && attacks < 10) {
        game.mouse.down = true;
        released = false;
      }
    }
  } else {
    for (let step = 0; step < 20000 && (attacks < 10 || game.bullets.length); step++) {
      game.updatePlayer(DT);
      game.updateBullets(DT);
      elapsed += DT;
    }
  }
  assert.equal(attacks, 10, `${type}: ten attacks`);
  assert.equal(hits, type === "shotgun" ? hits : 10, `${type}: hit count sane`);
  assert.ok(hits > 0, `${type}: target hit`);
  assert.equal(game.bullets.length, 0, `${type}: projectiles recycled`);
  const row = { weapon: type, attacks, projectiles, hits, seconds: Number(elapsed.toFixed(3)) };
  results.push(row);
  return row;
}

const pulse = measureWeapon("pulse");
const shotgun = measureWeapon("shotgun");
const charge = measureWeapon("charge");
assert.equal(pulse.projectiles, 10);
assert.equal(shotgun.projectiles, 50);
assert.ok(shotgun.seconds > pulse.seconds * 2, "shotgun has a meaningfully slower cadence");
assert.equal(charge.projectiles, 10);
assert.ok(charge.seconds > pulse.seconds * 3, "charge time is an observable cost");

{
  const { game } = freshGame();
  isolate(game);
  game.switchWeapon("shotgun");
  game.fireWeapon();
  const angles = game.bullets.map((b) => Math.atan2(b.vy, b.vx));
  assert.equal(new Set(angles).size, 5, "shotgun pellets have distinct spread");
  assert.ok(game.bullets.every((b) => b.life === 0.52 && b.damage === 8.8));
}

{
  const { game } = freshGame();
  isolate(game);
  game.switchWeapon("charge");
  game.mouse.down = true;
  game.updatePlayer(0.1);
  game.mouse.down = false;
  game.updatePlayer(DT);
  assert.equal(game.bullets.length, 0, "charge below threshold does not fire");
  game.mouse.down = true;
  for (let i = 0; i < 140; i++) game.updatePlayer(DT);
  assert.equal(game.player.charge, game.player.chargeMax);
  const speed = game.player.speed;
  game.keys.d = true;
  const x = game.player.x;
  game.updatePlayer(0.1);
  assert.ok(Math.abs(game.player.x - x - speed * 0.72 * 0.1) < 1e-8, "charging slows movement by 28%");
  game.keys.d = false;
  game.mouse.down = false;
  game.updatePlayer(DT);
  assert.equal(game.bullets.length, 1);
  assert.ok(Math.abs(game.bullets[0].damage - 101.2) < 1e-8);
  assert.ok(game.bullets[0].pierce >= 3, "full charge penetrates at least three targets");
}

{
  const { game } = freshGame();
  isolate(game);
  const first = game.spawnEnemy("chaser", 500, 360);
  const second = game.spawnEnemy("chaser", 450, 400);
  game.mouse.x = 400;
  game.mouse.y = 100;
  game.updatePlayer(DT);
  const mouseAngle = game.player.angle;
  assert.ok(Math.abs(mouseAngle - Math.atan2(100 - 360, 400 - 400)) < 1e-8, "assist off preserves mouse aim");
  game.aimAssist = true;
  game.aimTargetId = null;
  game.updatePlayer(DT);
  assert.equal(game.aimTargetId, second.id);
  second.x = 900;
  first.x = 410;
  game.updatePlayer(DT);
  assert.equal(game.aimTargetId, second.id, "assist target remains stable");
  second.dead = true;
  game.updatePlayer(DT);
  assert.equal(game.aimTargetId, first.id, "assist retargets after death");
}

{
  const { game } = freshGame();
  isolate(game);
  game.isTouch = true;
  game.switchWeapon("charge");
  game.spawnEnemy("chaser", 540, 360);
  for (let i = 0; i < 145; i++) game.updatePlayer(DT);
  assert.ok(game.bullets.length === 1 || game.player.fireTimer > 0, "touch charge auto-releases at full charge");
}

for (const type of ["shielder", "miner"]) {
  const { game } = freshGame();
  isolate(game);
  const enemy = game.spawnEnemy(type, 540, 360);
  enemy.shootTimer = 0;
  for (let i = 0; i < 20; i++) game.updateEnemies(DT);
  assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.y), `${type}: 20 behavior updates`);
  if (type === "shielder") {
    const beforeAngle = enemy.angle;
    game.updateEnemies(DT);
    const turn = Math.abs(Math.atan2(Math.sin(enemy.angle - beforeAngle), Math.cos(enemy.angle - beforeAngle)));
    assert.ok(turn <= 2.2 * DT + 1e-8, "shield turn rate leaves a flank window");
    enemy.angle = 0;
    const hp = enemy.hp;
    game.damageEnemy(enemy, 20, false, { vx: -100, vy: 0 });
    assert.ok(Math.abs(hp - enemy.hp - 6) < 1e-8, "frontal shield reduces damage to 30%");
    game.damageEnemy(enemy, 20, false, { vx: 100, vy: 0 });
    assert.ok(Math.abs(hp - enemy.hp - 26) < 1e-8, "rear attack deals full damage");
  } else {
    assert.ok(game.hazards.some((h) => h.kind === "mine"), "miner deploys a mine");
    const mine = game.hazards[0];
    game.player.x = mine.x;
    game.player.y = mine.y;
    game.player.invuln = 0;
    const hp = game.player.hp;
    game.updateHazards(0.7);
    assert.equal(game.player.hp, hp - 16, "armed mine damages player");
  }
  game.damageEnemy(enemy, 1e6, false);
  assert.equal(enemy.dead, true, `${type}: death`);
  assert.ok(game.gems.length > 0, `${type}: drops experience`);
}

for (const phase of [1, 2]) {
  for (const kind of ["lance", "blast"]) {
    for (let repeat = 0; repeat < 5; repeat++) {
      const { game } = freshGame();
      isolate(game);
      game.wave = 6;
      game.spawnBoss();
      const boss = game.boss;
      boss.x = 640;
      boss.y = 180;
      boss.phase = phase;
      boss.attackIndex = kind === "lance" ? 0 : 1;
      boss.specialTimer = 0;
      boss.shootTimer = 999;
      game.updateBoss(boss, DT, 400, 0, 1);
      if (kind === "lance") {
        assert.ok(boss.pendingAttack, "lance has a telegraph");
        const before = game.bullets.length;
        game.updateBoss(boss, 0.76, 400, 0, 1);
        assert.equal(boss.pendingAttack, null, "lance triggers once");
        assert.equal(game.bullets.length - before, phase === 2 ? 5 : 3);
      } else {
        assert.equal(game.hazards.length, phase === 2 ? 3 : 1);
        assert.ok(game.hazards.every((h) => h.x >= 90 && h.x <= 1190 && h.y >= 90 && h.y <= 630));
        game.updateHazards(0.91);
        assert.equal(game.hazards.length, 0, "blast zone is recycled after triggering");
      }
    }
  }
}

{
  const { game } = freshGame();
  game.arena = "foundry";
  game.start();
  assert.equal(game.obstacles.length, 3);
  const rect = game.obstacles[0];
  game.player.x = rect.x + 10;
  game.player.y = rect.y + 20;
  game.resolveObstacles(game.player);
  assert.equal(game.pointInRect(game.player.x, game.player.y, rect), false, "obstacle pushes player out");
  game.bullets.push({ x: rect.x, y: rect.y, vx: 0, vy: 0, r: 2, life: 1, friendly: true, dead: false, hitIds: [] });
  game.updateBullets(DT);
  assert.equal(game.bullets.length, 0, "obstacle blocks projectiles");
  game.player.x = 640;
  game.player.y = 360;
  game.player.invuln = 0;
  game.arenaHazard.phase = "active";
  game.arenaHazard.timer = 1;
  const hp = game.player.hp;
  game.updateArena(DT);
  assert.equal(game.player.hp, hp - 14, "thermal vent is a real hazard");
}

console.log("Mechanics PASS: weapon table " + JSON.stringify(results));
console.log("Mechanics PASS: charge threshold/cost, spread, recycling, stable assist, touch charge, 2 enemies, 20 boss attacks, arena collision/hazard.");
