'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/core.js');

const STEP = 1 / 60;

function makeEnemy(state, type, x, y, overrides) {
  const base = core.ENEMY_TYPES[type];
  const enemy = Object.assign({
    id: state.nextEnemyId++,
    type,
    name: base.name,
    x,
    y,
    hp: base.hp,
    maxHp: base.hp,
    radius: base.radius,
    speed: base.speed,
    damage: base.damage,
    score: base.score,
    knockbackScale: base.knockbackScale,
    age: 0,
    phase: 0,
    flash: 0,
    hitTick: 0,
    slow: 0,
    slowFactor: 0,
    knockX: 0,
    knockY: 0,
    dead: false
  }, overrides || {});
  state.enemies.push(enemy);
  return enemy;
}

function run(state, seconds, input) {
  const steps = Math.ceil(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    core.update(state, STEP, input || {});
    core.drainEvents(state);
  }
  return state;
}

function runCollect(state, seconds, input) {
  const steps = Math.ceil(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) {
    core.update(state, STEP, input || {});
    events.push(...core.drainEvents(state));
  }
  return events;
}

function clearDanger(state) {
  state.enemies.length = 0;
  state.spawnTimer = 999;
  state.player.hp = 999;
  state.player.maxHp = 999;
  state.player.invuln = 0;
}

test('初始状态符合设计', () => {
  const state = core.createGame({ seed: 1 });
  assert.equal(state.phase, 'playing');
  assert.equal(state.player.hp, 4);
  assert.equal(state.player.oil, 72);
  assert.equal(state.braziers.length, 4);
  assert.equal(core.getLitCount(state), 0);
  assert.equal(state.timeLeft, core.BALANCE.NIGHT_DURATION);
  assert.equal(core.getObjective(state), '点亮四座古灯（0 / 4）');
});

test('移动、斜向速度与边界限制', () => {
  const state = core.createGame({ seed: 2 });
  state.spawnTimer = 999;
  const startX = state.player.x;
  core.update(state, STEP, { moveX: 1, moveY: 0 });
  assert.ok(state.player.x > startX);

  const x = state.player.x;
  const y = state.player.y;
  core.update(state, STEP, { moveX: 1, moveY: 1 });
  const diagonal = Math.hypot(state.player.x - x, state.player.y - y);
  assert.ok(diagonal <= core.BALANCE.PLAYER_SPEED * STEP + 0.01, `diagonal=${diagonal}`);

  state.player.x = -500;
  state.player.y = -500;
  core.update(state, STEP, {});
  assert.equal(state.player.x, core.BALANCE.BOUNDS.left);
  assert.equal(state.player.y, core.BALANCE.BOUNDS.top);
});

test('灯塔是不可穿越的圆形碰撞体', () => {
  const state = core.createGame({ seed: 3 });
  state.spawnTimer = 999;
  state.player.x = core.BALANCE.LIGHTHOUSE_X;
  state.player.y = core.BALANCE.LIGHTHOUSE_Y + 8;
  core.update(state, STEP, {});
  const distance = core.getLighthouseDistance(state);
  assert.ok(distance >= core.BALANCE.LIGHTHOUSE_RADIUS + core.BALANCE.PLAYER_RADIUS - 0.01);
});

test('灯火锥只伤害面前目标，并消耗灯油', () => {
  const state = core.createGame({ seed: 4 });
  state.spawnTimer = 999;
  state.player.oil = 100;
  state.player.aimX = 1;
  state.player.aimY = 0;
  const front = makeEnemy(state, 'brute', state.player.x + 150, state.player.y, {
    hp: 100, maxHp: 100, speed: 0
  });
  const behind = makeEnemy(state, 'brute', state.player.x - 170, state.player.y, {
    hp: 100, maxHp: 100, speed: 0
  });
  run(state, 0.25, { focus: true, aimX: 1, aimY: 0 });
  assert.ok(front.hp < 100, 'front should take beam damage');
  assert.equal(behind.hp, 100, 'behind should be untouched');
  assert.ok(state.player.oil < 100, 'focus should consume oil');
});

test('灯油耗尽后灯火停止造成伤害', () => {
  const state = core.createGame({ seed: 5 });
  state.spawnTimer = 999;
  state.player.oil = 0;
  state.player.aimX = 1;
  state.player.aimY = 0;
  const target = makeEnemy(state, 'brute', state.player.x + 180, state.player.y, {
    hp: 50, maxHp: 50, speed: 0
  });
  run(state, 0.5, { focus: true, aimX: 1, aimY: 0 });
  assert.equal(target.hp, 50);
  assert.equal(state.player.beamActive, false);
});

test('点亮古灯需要持续交互，并正确扣油、补油、回血', () => {
  const state = core.createGame({ seed: 6 });
  state.spawnTimer = 999;
  const brazier = state.braziers[0];
  state.player.x = brazier.x + 20;
  state.player.y = brazier.y;
  state.player.hp = 2;
  state.player.oil = 50;

  run(state, 0.5, { interact: true });
  assert.equal(brazier.lit, false, 'half a second is not enough');
  assert.ok(brazier.progress > 0);

  run(state, core.BALANCE.BRAZIER_IGNITE_TIME, { interact: true });
  assert.equal(brazier.lit, true);
  assert.equal(state.braziersLit, 1);
  assert.equal(state.player.hp, 3);
  // 50 - 15 + 30，随后站在古灯光环内还会自然回复少量灯油
  assert.ok(state.player.oil >= 65 && state.player.oil < 68, `oil=${state.player.oil}`);
  assert.equal(core.getObjective(state), '点亮余下的古灯（1 / 4）');
});

test('提前松开交互会回退古灯进度', () => {
  const state = core.createGame({ seed: 7 });
  state.spawnTimer = 999;
  const brazier = state.braziers[0];
  state.player.x = brazier.x + 20;
  state.player.y = brazier.y;
  run(state, 0.6, { interact: true });
  const before = brazier.progress;
  assert.ok(before > 0);
  run(state, 1.0, { interact: false });
  assert.ok(brazier.progress < before);
  assert.equal(brazier.lit, false);
});

test('灯油不足时无法点燃古灯', () => {
  const state = core.createGame({ seed: 8 });
  state.spawnTimer = 999;
  const brazier = state.braziers[0];
  state.player.x = brazier.x + 20;
  state.player.y = brazier.y;
  state.player.oil = 10;
  const events = runCollect(state, 1.6, { interact: true });
  assert.equal(brazier.lit, false);
  assert.ok(events.some((event) => event.type === 'oil-empty' && event.reason === 'ignite'));
});

test('点亮第四盏古灯时补足返塔时间', () => {
  const state = core.createGame({ seed: 18 });
  state.spawnTimer = 999;
  state.braziers.forEach((brazier, index) => {
    if (index < 3) {
      brazier.lit = true;
      brazier.progress = core.BALANCE.BRAZIER_IGNITE_TIME;
    }
  });
  state.braziersLit = 3;
  state.timeLeft = 10;
  const last = state.braziers[3];
  state.player.x = last.x + 20;
  state.player.y = last.y;
  state.player.oil = 80;
  run(state, core.BALANCE.BRAZIER_IGNITE_TIME + 0.1, { interact: true });
  assert.equal(state.braziersLit, 4);
  assert.ok(state.timeLeft >= core.BALANCE.FINALE_MIN_TIME - 0.2, `timeLeft=${state.timeLeft}`);
  assert.equal(core.getObjective(state), '回到中央灯塔，唤醒长灯');
});

test('敌人会持续受到古灯光环伤害', () => {
  const state = core.createGame({ seed: 9 });
  state.spawnTimer = 999;
  const brazier = state.braziers[0];
  brazier.lit = true;
  state.braziersLit = 1;
  state.player.x = 640;
  state.player.y = 620;
  const enemy = makeEnemy(state, 'brute', brazier.x + 20, brazier.y, {
    hp: 100, maxHp: 100, speed: 0
  });
  run(state, 0.5, {});
  assert.ok(enemy.hp < 100);
});

test('接触伤害受无敌帧保护，不会每帧连扣', () => {
  const state = core.createGame({ seed: 10 });
  state.spawnTimer = 999;
  const attacker = makeEnemy(state, 'brute', state.player.x, state.player.y, { speed: 38 });
  core.update(state, STEP, {});
  assert.equal(state.player.hp, 2);
  assert.ok(Number.isFinite(attacker.knockX) && Number.isFinite(attacker.knockY),
    'contact knockback must remain finite');
  assert.ok(Number.isFinite(attacker.x) && Number.isFinite(attacker.y));
  core.update(state, STEP, {});
  assert.equal(state.player.hp, 2);
  run(state, 1.3, {});
  assert.ok(state.player.hp <= 2, 'contact should hurt again after i-frames');
  assert.ok(Number.isFinite(attacker.x) && Number.isFinite(attacker.y),
    'enemy must not become NaN after repeated contact');
});

test('疾步产生位移、冷却和短暂无敌', () => {
  const state = core.createGame({ seed: 11 });
  state.spawnTimer = 999;
  const startX = state.player.x;
  run(state, 0.12, { moveX: 1, dash: true });
  assert.ok(state.player.x - startX > 70, 'dash should move farther than normal movement');
  assert.ok(state.player.dashCooldown > 0);
  assert.equal(state.stats.dashes, 1);
  const after = state.player.x;
  run(state, 0.1, { moveX: 1, dash: true });
  assert.ok(state.player.x - after < 40, 'dash should not trigger while cooling down');
});

test('灯油拾取补充灯油并计入统计', () => {
  const state = core.createGame({ seed: 12 });
  state.spawnTimer = 999;
  state.player.oil = 30;
  state.pickups.push({ x: state.player.x, y: state.player.y, age: 0, ttl: 20, amount: 12 });
  run(state, 0.05, {});
  assert.equal(state.pickups.length, 0);
  assert.equal(state.player.oil, 42);
  assert.equal(state.oilCollected, 12);
});

test('倒计时归零导致失败', () => {
  const state = core.createGame({ seed: 13 });
  state.spawnTimer = 999;
  state.timeLeft = 0.01;
  run(state, 0.1, {});
  assert.equal(state.phase, 'defeat');
  assert.equal(core.getObjective(state), '长夜未央');
});

test('生命归零导致失败', () => {
  const state = core.createGame({ seed: 14 });
  state.spawnTimer = 999;
  state.player.hp = 1;
  state.player.invuln = 0;
  makeEnemy(state, 'brute', state.player.x, state.player.y, { speed: 0 });
  run(state, 0.05, {});
  assert.equal(state.phase, 'defeat');
});

test('四灯全亮后可在灯塔启动最终守夜并存活获胜', () => {
  const state = core.createGame({ seed: 15 });
  clearDanger(state);
  state.braziers.forEach((brazier) => {
    brazier.lit = true;
    brazier.progress = core.BALANCE.BRAZIER_IGNITE_TIME;
  });
  state.braziersLit = 4;
  state.flags.allLitAnnounced = true;
  state.player.x = core.BALANCE.LIGHTHOUSE_X;
  state.player.y = core.BALANCE.LIGHTHOUSE_Y + 70;

  run(state, 0.9, { interact: true });
  assert.equal(state.phase, 'finale');
  const auraAtStart = state.lighthouse.auraRadius;
  assert.ok(auraAtStart >= core.BALANCE.FINALE_AURA_START);

  run(state, 20.2, {});
  assert.equal(state.phase, 'victory');
  assert.ok(state.score >= 500);
  assert.ok(state.timeLeft >= 0);
  assert.equal(core.getObjective(state), '黎明已至');
});

test('最终守夜中死亡仍会失败', () => {
  const state = core.createGame({ seed: 16 });
  state.braziers.forEach((brazier) => {
    brazier.lit = true;
  });
  state.braziersLit = 4;
  state.flags.allLitAnnounced = true;
  state.phase = 'finale';
  state.finaleTime = 1;
  state.lighthouse.auraRadius = 150;
  state.player.hp = 1;
  state.player.invuln = 0;
  state.spawnTimer = 999;
  makeEnemy(state, 'brute', state.player.x, state.player.y, { speed: 0 });
  run(state, 0.05, {});
  assert.equal(state.phase, 'defeat');
});

test('同种子与同输入产生一致的敌人序列', () => {
  const a = core.createGame({ seed: 99 });
  const b = core.createGame({ seed: 99 });
  a.player.hp = 999;
  b.player.hp = 999;
  a.player.maxHp = 999;
  b.player.maxHp = 999;
  for (let i = 0; i < 1800; i++) {
    const input = { moveX: Math.sin(i / 30), moveY: Math.cos(i / 41) };
    core.update(a, STEP, input);
    core.update(b, STEP, input);
    core.drainEvents(a);
    core.drainEvents(b);
  }
  assert.equal(a.enemies.length, b.enemies.length);
  const aSummary = a.enemies.map((e) => [e.id, e.type, Math.round(e.x * 1000), Math.round(e.y * 1000)]);
  const bSummary = b.enemies.map((e) => [e.id, e.type, Math.round(e.x * 1000), Math.round(e.y * 1000)]);
  assert.deepEqual(aSummary, bSummary);
});

/* ---------------- 第二轮：模式 / 地图 / 灯塔 / 远征 / 新敌人 ---------------- */

test('模式、地图、灯塔类型配置可复现且互不相同', () => {
  const expedition = core.createGame({
    seed: 31, mode: 'expedition', mapId: 'river', lighthouseType: 'guide'
  });
  assert.equal(expedition.mode, 'expedition');
  assert.equal(expedition.mapId, 'river');
  assert.equal(expedition.lighthouseType, 'guide');
  assert.equal(expedition.timeLeft, 420);
  assert.equal(expedition.player.maxOil, 88);
  assert.equal(expedition.player.oil, 72);
  assert.equal(expedition.player.x, core.MAPS.river.startX);
  assert.equal(expedition.braziers.length, 4);
  assert.notEqual(expedition.braziers[0].id, 'north');
  assert.ok(Math.abs(core.getIgniteTime(expedition) - 1.44) < 0.001);

  const forest = core.createGame({
    seed: 31, mode: 'expedition', mapId: 'forest', lighthouseType: 'ward'
  });
  assert.notDeepEqual(
    expedition.braziers.map((b) => [b.x, b.y]),
    forest.braziers.map((b) => [b.x, b.y])
  );
  assert.equal(core.MAPS.forest.spawnRateMult, 1.2);
  assert.equal(core.MAPS.village.spawnRateMult, 1);
  assert.ok(core.MAPS.river.river);
});

test('三类灯塔各有可观察的取舍', () => {
  const classic = core.createGame({ seed: 32, lighthouseType: 'classic' });
  const ember = core.createGame({ seed: 32, lighthouseType: 'ember' });
  const ward = core.createGame({ seed: 32, lighthouseType: 'ward' });
  const guide = core.createGame({ seed: 32, lighthouseType: 'guide' });

  assert.ok(core.getBeamDps(ember) < core.getBeamDps(classic));
  assert.ok(core.getBrazierAuraRegen(ember) > core.getBrazierAuraRegen(classic));
  assert.ok(core.getBrazierAuraRadius(ward) > core.getBrazierAuraRadius(classic));
  assert.ok(core.getBrazierAuraDps(ward) > core.getBrazierAuraDps(classic));
  assert.ok(core.getBeamOilPerSec(ward) > core.getBeamOilPerSec(classic));
  assert.equal(guide.player.maxOil, 88);
  assert.ok(core.getIgniteTime(guide) < core.getIgniteTime(classic));
  assert.equal(core.getLighthouseConfig(guide).showGuide, true);
});

test('冻河涉水变慢并消耗灯油，桥面不受影响', () => {
  const state = core.createGame({ seed: 33, mapId: 'river' });
  state.spawnTimer = 999;
  state.player.x = 640;
  state.player.y = 510;
  state.player.oil = 72;
  const startX = state.player.x;
  run(state, 0.5, { moveX: 1 });
  const wadeDistance = state.player.x - startX;
  assert.equal(state.player.wading, true);
  assert.ok(wadeDistance < 70, `wadeDistance=${wadeDistance}`);
  assert.ok(state.player.oil < 72);
  assert.equal(core.isInRiver(core.MAPS.river, 640, 510), true);

  state.player.x = 330;
  state.player.y = 510;
  state.player.oil = 72;
  state.player.wading = false;
  const bridgeStart = state.player.x;
  run(state, 0.2, { moveX: 1 });
  assert.equal(state.player.wading, false);
  assert.ok(state.player.x - bridgeStart > 30, 'bridge movement should be full speed');
  assert.ok(state.player.oil >= 71.99, `bridge oil=${state.player.oil}`);
  assert.equal(core.isOnBridge(core.MAPS.river, 370), true);
});

test('远征四灯后进入运油阶段，灯塔尚未可启动', () => {
  const state = core.createGame({
    seed: 34, mode: 'expedition', mapId: 'forest', lighthouseType: 'classic'
  });
  clearDanger(state);
  state.player.hp = 999;
  state.player.maxHp = 999;
  for (const brazier of state.braziers) {
    state.player.x = brazier.x + 20;
    state.player.y = brazier.y;
    state.player.oil = 100;
    run(state, core.getIgniteTime(state) + 0.06, { interact: true });
  }
  assert.equal(core.getLitCount(state), 4);
  assert.equal(state.expedition.stage, 2);
  assert.ok(state.expedition.cargo);
  assert.match(core.getObjective(state), /长灯油/);

  state.player.x = 640;
  state.player.y = 440;
  run(state, 1.0, { interact: true });
  assert.equal(state.phase, 'playing', '远征未完成阶段时不能提前进入终局');
  assert.equal(core.getInteractTarget(state), null);
});

test('远征依次完成运油、携灯影、缠雾者后回塔获胜', () => {
  const state = core.createGame({
    seed: 35, mode: 'expedition', mapId: 'forest', lighthouseType: 'classic'
  });
  clearDanger(state);
  state.player.hp = 999;
  state.player.maxHp = 999;
  for (const brazier of state.braziers) {
    state.player.x = brazier.x + 20;
    state.player.y = brazier.y;
    state.player.oil = 100;
    run(state, core.getIgniteTime(state) + 0.06, { interact: true });
  }
  assert.equal(state.expedition.stage, 2);

  for (let i = 0; i < 5; i++) {
    const cargo = state.expedition.cargo;
    assert.ok(cargo);
    state.player.x = cargo.x;
    state.player.y = cargo.y;
    run(state, 0.15, {});
    assert.equal(state.player.carrying, true);
    state.player.x = 640;
    state.player.y = 444;
    run(state, 0.2, {});
  }
  assert.equal(state.expedition.stage, 3);
  assert.equal(state.enemies.filter((enemy) => enemy.type === 'thief' && enemy.quest).length, 1);
  assert.match(core.getObjective(state), /携灯影/);

  /* 放置一段时间，环境灯光不能替玩家自动完成追灯阶段 */
  state.spawnTimer = 999;
  run(state, 3.0, {});
  assert.equal(state.expedition.stage, 3);
  assert.equal(state.enemies.filter((enemy) => enemy.type === 'thief' && enemy.quest).length, 1);

  state.spawnTimer = 999;
  for (let i = 0; i < 3; i++) {
    const thief = state.enemies.find((enemy) => enemy.type === 'thief' && enemy.quest);
    assert.ok(thief, 'thief ' + (i + 1) + ' should spawn');
    thief.x = 640;
    thief.y = 330;
    thief.hp = 1;
    thief.speed = 0;
    state.player.x = 640;
    state.player.y = 440;
    state.player.aimX = 0;
    state.player.aimY = -1;
    state.player.oil = 100;
    run(state, 0.2, { focus: true, aimX: 0, aimY: -1 });
  }
  assert.equal(state.expedition.stage, 4);
  assert.match(core.getObjective(state), /缠雾者/);

  state.spawnTimer = 999;
  assert.equal(state.enemies.filter((enemy) => enemy.type === 'weaver' && enemy.quest).length, 1);
  for (let i = 0; i < 3; i++) {
    const weaver = state.enemies.find((enemy) => enemy.type === 'weaver' && enemy.quest);
    assert.ok(weaver, 'weaver ' + (i + 1) + ' should spawn');
    weaver.x = 640;
    weaver.y = 320;
    weaver.hp = 1;
    weaver.speed = 0;
    state.player.x = 640;
    state.player.y = 440;
    state.player.aimX = 0;
    state.player.aimY = -1;
    state.player.oil = 100;
    run(state, 0.2, { focus: true, aimX: 0, aimY: -1 });
  }
  assert.equal(state.expedition.stage, 5);
  assert.match(core.getObjective(state), /回到长灯/);

  state.player.x = 640;
  state.player.y = 440;
  run(state, 0.9, { interact: true });
  assert.equal(state.phase, 'finale');
  assert.equal(state.finaleDuration, 30);
  state.player.hp = 999;
  run(state, 30.2, {});
  assert.equal(state.phase, 'victory');
});

test('携灯影会窃取古灯，击杀后归还灯芯', () => {
  const state = core.createGame({ seed: 36, mapId: 'village' });
  state.spawnTimer = 999;
  state.player.x = 500;
  state.player.y = 500;
  state.player.hp = 999;
  state.player.maxHp = 999;
  const brazier = state.braziers[0];
  brazier.lit = true;
  brazier.progress = 1.8;
  state.braziersLit = 1;
  const thief = core.spawnEnemy(state, 'thief', {
    x: brazier.x + 20, y: brazier.y, force: true
  });
  thief.speed = 0;
  thief.hp = 100;
  thief.maxHp = 100;
  run(state, 2.2, {});
  assert.equal(thief.stolen, true);
  assert.ok(brazier.suppressed > 0);
  assert.equal(core.getBrazierAuraDps(state), 5);

  state.player.x = brazier.x - 120;
  state.player.y = brazier.y;
  state.player.aimX = 1;
  state.player.aimY = 0;
  state.player.oil = 100;
  thief.hp = 1;
  run(state, 0.25, { focus: true, aimX: 1, aimY: 0 });
  assert.equal(state.enemies.includes(thief), false);
  assert.equal(brazier.suppressed, 0);
  assert.equal(brazier.stolenBy, null);
});

test('缠雾者预警后生成雾气，减速并可用灯火驱散', () => {
  const state = core.createGame({ seed: 37, mapId: 'village' });
  state.spawnTimer = 999;
  state.player.x = 640;
  state.player.y = 400;
  state.player.hp = 999;
  state.player.maxHp = 999;
  const weaver = core.spawnEnemy(state, 'weaver', {
    x: 400, y: 400, force: true
  });
  weaver.speed = 0;
  weaver.fogCooldown = 0;
  run(state, 1.2, {});
  assert.equal(state.fogZones.length, 1);
  const fog = state.fogZones[0];
  assert.ok(fog.hp > 0);

  state.player.x = fog.x;
  state.player.y = fog.y;
  state.player.oil = 72;
  const beforeX = state.player.x;
  run(state, 0.5, { moveX: 1 });
  assert.equal(state.player.fogged, true);
  assert.ok(state.player.x - beforeX < 70, 'fog should slow movement');
  assert.ok(state.player.oil < 72, 'fog should drain oil');

  state.player.x = fog.x - 110;
  state.player.y = fog.y;
  state.player.aimX = 1;
  state.player.aimY = 0;
  state.player.oil = 100;
  run(state, 0.9, { focus: true, aimX: 1, aimY: 0 });
  assert.equal(state.fogZones.length, 0);
  assert.ok(state.stats.fogCleared >= 1);
});

test('携带灯油时受伤会掉落，可重新拾取', () => {
  const state = core.createGame({
    seed: 38, mode: 'expedition', mapId: 'village', lighthouseType: 'classic'
  });
  state.spawnTimer = 999;
  state.expedition.stage = 2;
  state.expedition.cargo = { x: 640, y: 500, index: 0, carried: false, pickupCooldown: 0 };
  state.player.x = 640;
  state.player.y = 500;
  state.player.hp = 4;
  state.player.invuln = 0;
  run(state, 0.1, {});
  assert.equal(state.expedition.cargo.carried, true);
  const brute = makeEnemy(state, 'brute', state.player.x, state.player.y, { speed: 0 });
  run(state, 0.02, {});
  assert.equal(state.expedition.cargo.carried, false);
  assert.ok(state.player.hp < 4);
  assert.ok(state.expedition.cargo.pickupCooldown > 0);
  assert.equal(brute.dead, false);
});

test('长时间输入在远征/冻河/引路灯配置下仍无非法状态', () => {
  const state = core.createGame({
    seed: 39, mode: 'expedition', mapId: 'river', lighthouseType: 'guide'
  });
  state.player.hp = 999;
  state.player.maxHp = 999;
  let seed = 998877;
  function rnd() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 6000; i++) {
    const input = {
      moveX: rnd() * 2 - 1, moveY: rnd() * 2 - 1,
      aimX: rnd() * 2 - 1, aimY: rnd() * 2 - 1,
      focus: rnd() < 0.4, interact: rnd() < 0.3, dash: rnd() < 0.02
    };
    core.update(state, STEP, input);
    core.drainEvents(state);
    assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y));
    assert.ok(state.player.oil >= 0 && state.player.oil <= state.player.maxOil);
    assert.ok(state.enemies.length <= core.BALANCE.MAX_ENEMIES + 4);
    assert.ok(state.fogZones.length <= core.BALANCE.MAX_FOG_ZONES);
    if (state.expedition && state.expedition.cargo) {
      assert.ok(Number.isFinite(state.expedition.cargo.x));
    }
  }
});

test('长时间随机输入不产生 NaN、不越界、不超上限', () => {
  const state = core.createGame({ seed: 2026 });
  state.player.hp = 999;
  state.player.maxHp = 999;
  let seed = 123456789;
  function rnd() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 10000; i++) {
    const input = {
      moveX: rnd() * 2 - 1,
      moveY: rnd() * 2 - 1,
      aimX: rnd() * 2 - 1,
      aimY: rnd() * 2 - 1,
      focus: rnd() < 0.35,
      interact: rnd() < 0.2,
      dash: rnd() < 0.02
    };
    core.update(state, STEP, input);
    core.drainEvents(state);
    assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y));
    assert.ok(Number.isFinite(state.player.oil));
    assert.ok(state.player.oil >= 0 && state.player.oil <= core.BALANCE.OIL_MAX);
    assert.ok(state.player.x >= core.BALANCE.BOUNDS.left && state.player.x <= core.BALANCE.BOUNDS.right);
    assert.ok(state.player.y >= core.BALANCE.BOUNDS.top && state.player.y <= core.BALANCE.BOUNDS.bottom);
    assert.ok(state.enemies.length <= core.BALANCE.MAX_ENEMIES);
    assert.ok(state.pickups.length <= core.BALANCE.MAX_PICKUPS);
  }
});
