"use strict";

const assert = require("node:assert/strict");
const { freshGame } = require("./harness.cjs");

{
  const { game } = freshGame();
  const quotas = [8, 12, 16, 20, 24];
  for (let wave = 1; wave <= 5; wave++) {
    assert.equal(game.wave, wave);
    assert.equal(game.waveQuota, quotas[wave - 1]);
    game.nextWave();
  }
  assert.equal(game.wave, 6);
  assert.ok(game.boss && game.boss.type === "boss", "sixth wave spawns boss");
}

{
  const { game } = freshGame();
  game.mouse.down = true;
  game.togglePause();
  const elapsed = game.elapsed;
  const hp = game.player.hp;
  assert.equal(game.state, "paused");
  assert.equal(game.mouse.down, false);
  if (game.state === "playing") game.update(1);
  assert.equal(game.elapsed, elapsed);
  assert.equal(game.player.hp, hp);
  game.togglePause();
  assert.equal(game.state, "playing");
}

{
  const { game, elements } = freshGame();
  game.hurtPlayer(100, "test-lethal");
  assert.equal(game.state, "gameover");
  assert.equal(game.player.hp, 0);
  game.updateHUD();
  assert.equal(elements.get("hpText").textContent, "0 / 100");
  game.endGame(true);
  assert.equal(game.state, "gameover", "duplicate settlement cannot flip failure to victory");
  const hp = game.player.hp;
  game.healPlayer(35, "late-heal");
  assert.equal(game.player.hp, hp, "post-mortem healing is rejected");
}

{
  const { game } = freshGame();
  game.wave = 6;
  game.spawnBoss();
  game.damageEnemy(game.boss, 1e6, false);
  assert.equal(game.state, "victory");
  const score = game.score;
  game.endGame(false);
  game.endGame(true);
  assert.equal(game.state, "victory");
  assert.equal(game.score, score, "repeated settlement does not change score");
}

for (let i = 0; i < 10; i++) {
  const { game } = freshGame();
  game.keys.d = true;
  game.keys.j = true;
  game.mouse.down = true;
  game.joy.active = true;
  game.joy.x = 1;
  game.switchWeapon("charge");
  game.player.charge = 1;
  game.score = 9999;
  game.wave = 6;
  game.hazards.push({ kind: "mine" });
  game.start();
  assert.equal(game.wave, 1);
  assert.equal(game.player.hp, 100);
  assert.equal(game.player.weapon, "pulse");
  assert.equal(game.player.charge, 0);
  assert.equal(game.score, 0);
  assert.equal(game.kills, 0);
  assert.equal(game.elapsed, 0);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.hazards.length, 0);
  assert.equal(game.keys.d, undefined);
  assert.equal(game.mouse.down, false);
  assert.equal(game.joy.active, false);
}

{
  const { game, elements, flushTimers } = freshGame();
  game.player.xp = 1000;
  game.openUpgrade();
  assert.equal(game.state, "levelup");
  elements.get("upgradeCards").children[0].click();
  assert.equal(game.state, "playing");
  game.start();
  flushTimers();
  assert.equal(game.state, "playing", "old upgrade timer cannot interrupt a restarted run");
  assert.equal(game.player.level, 1);
  assert.equal(game.player.xp, 0);
}

{
  const { game, elements, flushTimers } = freshGame();
  game.player.xp = 1000;
  game.openUpgrade();
  elements.get("upgradeCards").children[0].click();
  flushTimers();
  assert.equal(game.state, "levelup", "valid queued upgrades still chain in the same run");
}

// Integrated same-frame order: contact damage -> bullet kill -> wave repair -> HUD.
{
  const { game, elements } = freshGame();
  game.announce = () => {};
  game.player.hp = 52;
  game.wave = 1;
  game.waveQuota = 1;
  game.spawned = 1;
  game.waveKills = 1;
  const enemy = game.spawnEnemy("chaser", game.player.x, game.player.y);
  enemy.hp = 1;
  game.bullets.push({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, r: 5, damage: 10, friendly: true, life: 1, pierce: 0, critical: false, hitIds: [], dead: false });
  game.update(1 / 120);
  assert.equal(game.player.hp, 52, "52 -> 40 -> 52 is a zero net change");
  assert.equal(Array.from(game.combatLog, (entry) => entry.kind).join(","), "hurt,heal");
  assert.equal(game.combatLog[0].after, 40);
  assert.equal(game.combatLog[1].after, 52);
  assert.equal(elements.get("hpText").textContent, "52 / 100", "HUD reads final post-wave state");
}

console.log("State/flow PASS: six waves, pause/resume, lethal failure, boss victory, duplicate settlement, 10 restarts, upgrade timer isolation, same-frame HP/HUD order.");
