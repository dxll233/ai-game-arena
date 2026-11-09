"use strict";

const assert = require("node:assert/strict");
const { freshGame } = require("./harness.cjs");

const initialValues = [100, 96, 52, 12, 1];
const sequences = ["none", "hurt-heal", "heal-hurt", "same-frame", "invuln-hurt-heal"];
let assertions = 0;
const rows = [];

function check(game, expected, label, elements) {
  assert.ok(game.player.hp >= 0 && game.player.hp <= game.player.maxHp, `${label}: HP out of bounds`);
  assert.ok(Math.abs(game.player.hp - expected) < 1e-8, `${label}: expected ${expected}, got ${game.player.hp}`);
  game.updateHUD();
  assert.equal(elements.get("hpText").textContent, `${Math.ceil(game.player.hp)} / ${Math.ceil(game.player.maxHp)}`, `${label}: HUD final value`);
  assertions += 3;
}

function heal(game, source) {
  const p = game.player;
  if (source === "upgrade") game.getUpgrades().find((u) => u.name === "纳米修复").apply(p);
  if (source === "wave") {
    game.wave = 1;
    game.waveQuota = 1;
    game.spawned = 1;
    game.waveKills = 1;
    game.enemies = [];
    game.waveClearTimer = 0;
    game.updateWave(0);
  }
  if (source === "regen") {
    p.regen = 10;
    game.updatePlayer(1);
  }
}

for (const source of ["upgrade", "wave", "regen"]) {
  const amount = source === "upgrade" ? 35 : source === "wave" ? 12 : 10;
  for (const initial of initialValues) {
    for (const sequence of sequences) {
      for (let repeat = 0; repeat < 10; repeat++) {
        const { game, elements } = freshGame();
        game.player.hp = initial;
        game.player.invuln = sequence === "invuln-hurt-heal" ? 0.72 : 0;
        let expected = initial;
        const hurt = () => {
          const before = game.player.hp;
          game.hurtPlayer(7);
          return game.player.hp;
        };
        if (sequence === "hurt-heal" || sequence === "invuln-hurt-heal" || (sequence === "same-frame" && source !== "regen")) {
          expected = hurt();
          if (expected > 0) {
            heal(game, source);
            expected = Math.min(game.player.maxHp, expected + amount);
          }
        } else if (sequence === "heal-hurt" || sequence === "same-frame") {
          heal(game, source);
          expected = Math.min(game.player.maxHp, expected + amount);
          expected = hurt();
        } else {
          heal(game, source);
          expected = Math.min(game.player.maxHp, expected + amount);
        }
        check(game, expected, `${source}/${initial}/${sequence}/${repeat}`, elements);
        const hurtFirst = sequence === "hurt-heal" || sequence === "invuln-hurt-heal" || (sequence === "same-frame" && source !== "regen");
        const expectedLog = [];
        if (hurtFirst) {
          if (sequence === "invuln-hurt-heal") {
            if (initial < 100) expectedLog.push("heal");
          } else {
            expectedLog.push("hurt");
            if (initial > 7) expectedLog.push("heal");
          }
        } else {
          if (sequence !== "none" || initial < 100) {
            if (initial < 100) expectedLog.push("heal");
          }
          if (sequence === "heal-hurt" || sequence === "same-frame") expectedLog.push("hurt");
        }
        assert.equal(Array.from(game.combatLog, (entry) => entry.kind).join(","), expectedLog.join(","), `${source}/${initial}/${sequence}: event order`);
        assertions += 1;
      }
    }
  }
  rows.push(`${source}: 250 cases`);
}

for (const invuln of [0, 0.2, 0.72]) {
  for (let repeat = 0; repeat < 10; repeat++) {
    const { game, elements } = freshGame();
    game.player.hp = 52;
    game.player.invuln = invuln;
    game.hurtPlayer(12);
    check(game, invuln > 0 ? 52 : 40, `invuln/${invuln}/${repeat}`, elements);
    assert.equal(game.combatLog.length, invuln > 0 ? 0 : 1, "invulnerability blocks damage event");
  }
}

// First-round report reproduction: 52 -> 40 -> 52 is a zero net change, not failed healing.
{
  const { game, elements } = freshGame();
  game.player.hp = 52;
  game.hurtPlayer(12);
  game.player.invuln = 0;
  heal(game, "wave");
  check(game, 52, "reported-52-net-zero", elements);
  assert.equal(Array.from(game.combatLog, (entry) => entry.kind).join(","), "hurt,heal");
}

console.log(`HP matrix PASS: ${assertions} assertions; ${rows.join(", ")}; 30 invulnerability cases; 52-point net-zero reproduction.`);
