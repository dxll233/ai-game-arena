'use strict';

/*
 * 简易自动守夜人：只用于核心规则的可通关性 / 节奏信号。
 * 运行：
 *   node tests/balance-sim.js [局数]
 *   node tests/balance-sim.js 36 expedition
 *   node tests/balance-sim.js 36 expedition mixed
 *
 * 这是核心规则模拟，不是浏览器试玩，也不代表真人水平。
 * 它不使用调试传跳或无敌，只向 core.update 传入正常的移动/瞄准/交互输入。
 */

const core = require('../js/core.js');
const B = core.BALANCE;
const STEP = 1 / 60;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function len(x, y) { return Math.hypot(x, y); }
function norm(x, y) {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d };
}

function nearestEnemy(state) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    const d = len(enemy.x - state.player.x, enemy.y - state.player.y);
    if (d < bestD) { bestD = d; best = enemy; }
  }
  return best ? { enemy: best, distance: bestD } : null;
}

function nearestQuestThief(state) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.type !== 'thief' || enemy.dead || !enemy.quest) continue;
    const d = len(enemy.x - state.player.x, enemy.y - state.player.y);
    if (d < bestD) { bestD = d; best = enemy; }
  }
  return best ? { enemy: best, distance: bestD } : null;
}

function nearestQuestWeaver(state) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.type !== 'weaver' || enemy.dead || !enemy.quest) continue;
    const d = len(enemy.x - state.player.x, enemy.y - state.player.y);
    if (d < bestD) { bestD = d; best = enemy; }
  }
  return best ? { enemy: best, distance: bestD } : null;
}

function nearestPickup(state) {
  let best = null;
  let bestD = Infinity;
  for (const pickup of state.pickups) {
    const d = len(pickup.x - state.player.x, pickup.y - state.player.y);
    if (d < bestD) { bestD = d; best = pickup; }
  }
  return best ? { pickup: best, distance: bestD } : null;
}

function nearestLitBrazier(state) {
  let best = null;
  let bestD = Infinity;
  for (const brazier of state.braziers) {
    if (!brazier.lit || brazier.suppressed > 0) continue;
    const d = len(brazier.x - state.player.x, brazier.y - state.player.y);
    if (d < bestD) { bestD = d; best = brazier; }
  }
  return best ? { brazier: best, distance: bestD } : null;
}

function chooseTarget(state) {
  const p = state.player;
  const lit = core.getLitCount(state);
  const nearest = core.getNearestBrazier(state, false);
  const expedition = state.expedition;
  let target = null;
  let interact = false;

  if (state.phase === 'finale') {
    const angle = state.elapsed * 0.9;
    return {
      target: {
        x: B.LIGHTHOUSE_X + Math.cos(angle) * 92,
        y: B.LIGHTHOUSE_Y + Math.sin(angle) * 70
      },
      interact: false
    };
  }

  if (expedition) {
    if (expedition.stage === 1) {
      if (p.oil < 22) {
        const pick = nearestPickup(state);
        if (pick && pick.distance < 380) return { target: { x: pick.pickup.x, y: pick.pickup.y }, interact: false };
      }
      if (nearest) {
        target = { x: nearest.brazier.x, y: nearest.brazier.y };
        if (nearest.distance < 58 && p.oil >= B.BRAZIER_IGNITE_COST) interact = true;
      }
      return { target, interact };
    }

    if (expedition.stage === 2) {
      const cargo = expedition.cargo;
      if (cargo && !cargo.carried) {
        target = { x: cargo.x, y: cargo.y };
      } else {
        target = { x: B.LIGHTHOUSE_X, y: B.LIGHTHOUSE_Y + 73 };
      }
      return { target, interact: false };
    }

    if (expedition.stage === 3) {
      if (p.oil < 15) {
        const litBrazier = nearestLitBrazier(state);
        if (litBrazier && litBrazier.distance < 420) {
          target = { x: litBrazier.brazier.x, y: litBrazier.brazier.y };
          return { target, interact: false };
        }
      }
      const thief = nearestQuestThief(state);
      if (thief) {
        target = { x: thief.enemy.x, y: thief.enemy.y };
      } else {
        target = { x: B.LIGHTHOUSE_X, y: B.LIGHTHOUSE_Y + 73 };
      }
      return { target, interact: false };
    }

    if (expedition.stage === 4) {
      if (p.oil < 15) {
        const litBrazier = nearestLitBrazier(state);
        if (litBrazier && litBrazier.distance < 420) {
          target = { x: litBrazier.brazier.x, y: litBrazier.brazier.y };
          return { target, interact: false };
        }
      }
      const weaver = nearestQuestWeaver(state);
      if (weaver) {
        target = { x: weaver.enemy.x, y: weaver.enemy.y };
      } else {
        target = { x: B.LIGHTHOUSE_X, y: B.LIGHTHOUSE_Y + 73 };
      }
      return { target, interact: false };
    }

    target = { x: B.LIGHTHOUSE_X, y: B.LIGHTHOUSE_Y + 73 };
    if (core.getLighthouseDistance(state) < 95) interact = true;
    return { target, interact };
  }

  /* 短夜 / 旧规则 */
  if (lit === 4) {
    target = { x: B.LIGHTHOUSE_X, y: B.LIGHTHOUSE_Y + 73 };
    if (core.getLighthouseDistance(state) < 95) interact = true;
    return { target, interact };
  }
  if (p.oil < 30) {
    const pick = nearestPickup(state);
    if (pick && pick.distance < 380) {
      target = { x: pick.pickup.x, y: pick.pickup.y };
    } else if (lit > 0) {
      const litBrazier = nearestLitBrazier(state);
      if (litBrazier) target = { x: litBrazier.brazier.x, y: litBrazier.brazier.y };
    }
  }
  if (!target && nearest) {
    target = { x: nearest.brazier.x, y: nearest.brazier.y };
    if (nearest.distance < 58 && p.oil >= B.BRAZIER_IGNITE_COST) interact = true;
  }
  return { target, interact };
}

function policy(state) {
  const p = state.player;
  const decision = chooseTarget(state);
  const target = decision.target;
  const enemies = nearestEnemy(state);
  const thief = nearestQuestThief(state);
  const weaver = nearestQuestWeaver(state);
  let interact = decision.interact;
  let focus = false;
  let dash = false;
  let aimX = p.aimX;
  let aimY = p.aimY;
  let moveX = 0;
  let moveY = 0;

  if (target) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const distance = len(dx, dy);
    if (distance > 22) {
      const dir = norm(dx, dy);
      moveX = dir.x;
      moveY = dir.y;
      const lhDist = len(p.x - B.LIGHTHOUSE_X, p.y - B.LIGHTHOUSE_Y);
      if (lhDist < 84 && distance > 120) {
        moveX += -dir.y * 0.9;
        moveY += dir.x * 0.9;
      }
    }
  }

  /* 优先射杀任务携灯影，其次处理近身威胁 */
  const aimEnemy = thief && thief.distance < 430
    ? thief.enemy
    : weaver && weaver.distance < 430 ? weaver.enemy : enemies && enemies.enemy;
  if (aimEnemy) {
    const aim = norm(aimEnemy.x - p.x, aimEnemy.y - p.y);
    aimX = aim.x;
    aimY = aim.y;
    const aimDistance = len(aimEnemy.x - p.x, aimEnemy.y - p.y);
    const shouldBurn = aimDistance < 300 || state.phase === 'finale';
    if (shouldBurn && p.oil > 4) focus = true;
    if (enemies && enemies.distance < 58 && p.dashCooldown <= 0) {
      dash = true;
      const away = norm(p.x - enemies.enemy.x, p.y - enemies.enemy.y);
      moveX = away.x;
      moveY = away.y;
    }
  } else if (target) {
    const aim = norm(target.x - p.x, target.y - p.y);
    aimX = aim.x;
    aimY = aim.y;
  }

  if (interact && (!enemies || enemies.distance > 160)) focus = false;

  return {
    moveX: clamp(moveX, -1, 1),
    moveY: clamp(moveY, -1, 1),
    aimX,
    aimY,
    focus,
    interact,
    dash
  };
}

function runOne(seed, mode, mapId, lighthouseType) {
  const state = core.createGame({
    seed,
    mode,
    mapId,
    lighthouseType
  });
  let steps = 0;
  let illegal = null;
  const maxSteps = 60 * 500;
  while ((state.phase === 'playing' || state.phase === 'finale') && steps < maxSteps) {
    core.update(state, STEP, policy(state));
    core.drainEvents(state);
    steps++;
    if (process.env.SIM_DEBUG && state.expedition && state.expedition.stage === 4 && steps % 300 === 0) {
      const living = state.enemies.filter((e) => e.type === 'weaver' && e.quest).map((e) => ({
        x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), d: Math.round(len(e.x - state.player.x, e.y - state.player.y))
      }));
      console.error('DEBUG', { t: state.elapsed.toFixed(1), player: [Math.round(state.player.x), Math.round(state.player.y)], killed: state.expedition.weaversKilled, living, fog: state.fogZones.length });
    }
    if (process.env.SIM_DEBUG) {
      const bad = state.enemies.find((e) => !Number.isFinite(e.x) || !Number.isFinite(e.y));
      if (bad) {
        console.error('NAN', JSON.stringify({
          t: state.elapsed,
          stage: state.expedition && state.expedition.stage,
          bad,
          player: { x: state.player.x, y: state.player.y, aimX: state.player.aimX, aimY: state.player.aimY, dashTime: state.player.dashTime },
          nearby: state.enemies.filter((e) => Math.abs(e.y - bad.y) < 100 || Math.abs(e.x - bad.x) < 100).slice(0, 5)
        }));
        illegal = 'nan-enemy-at-' + steps;
        break;
      }
    }
    if (!Number.isFinite(state.player.x) || !Number.isFinite(state.player.y) ||
      !Number.isFinite(state.player.oil) || state.enemies.length > B.MAX_ENEMIES + 4) {
      illegal = 'invalid-state-at-' + steps;
      break;
    }
  }
  return {
    seed,
    mode,
    mapId,
    lighthouseType,
    phase: state.phase,
    seconds: Number(state.elapsed.toFixed(1)),
    stage: state.expedition ? state.expedition.stage : null,
    lit: core.getLitCount(state),
    hp: state.player.hp,
    score: state.score,
    kills: state.kills,
    finaleTime: Number(state.finaleTime.toFixed(1)),
    timeLeft: Number(state.timeLeft.toFixed(1)),
    illegal
  };
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))));
  return sorted[idx];
}

const count = Math.max(1, parseInt(process.argv[2] || '36', 10));
const mode = process.argv[3] === 'expedition' ? 'expedition' : 'short';
const mapMode = process.argv[4] || 'village';
const maps = mapMode === 'mixed' ? ['village', 'forest', 'river'] : [core.MAPS[mapMode] ? mapMode : 'village'];
const types = ['ember', 'ward', 'guide'];
const results = [];

for (let i = 0; i < count; i++) {
  const mapId = maps[i % maps.length];
  const lighthouseType = types[i % types.length];
  results.push(runOne(4200 + i * 7919, mode, mapId, lighthouseType));
}

const wins = results.filter((r) => r.phase === 'victory');
const deaths = results.filter((r) => r.phase === 'defeat');
const illegal = results.filter((r) => r.illegal);
const allSeconds = results.map((r) => r.seconds);
const winSeconds = wins.map((r) => r.seconds);
const stages = [0, 0, 0, 0, 0, 0];
for (const r of results) if (r.stage) stages[r.stage]++;

const byMap = {};
for (const mapId of maps) {
  const subset = results.filter((r) => r.mapId === mapId);
  byMap[mapId] = {
    runs: subset.length,
    wins: subset.filter((r) => r.phase === 'victory').length,
    avgSeconds: Number((subset.reduce((s, r) => s + r.seconds, 0) / Math.max(1, subset.length)).toFixed(1))
  };
}

console.log(JSON.stringify({
  mode,
  maps,
  runs: count,
  wins: wins.length,
  winRate: (wins.length / count * 100).toFixed(1) + '%',
  defeat: deaths.length,
  illegal: illegal.length,
  illegalSamples: illegal.slice(0, 3),
  avgSecondsAll: Number((allSeconds.reduce((s, v) => s + v, 0) / count).toFixed(1)),
  avgSecondsWin: Number((winSeconds.reduce((s, v) => s + v, 0) / Math.max(1, wins.length)).toFixed(1)),
  minSecondsWin: Math.min(...winSeconds),
  maxSecondsWin: Math.max(...winSeconds),
  p25SecondsWin: percentile(winSeconds, 25),
  p75SecondsWin: percentile(winSeconds, 75),
  avgKills: Number((results.reduce((s, r) => s + r.kills, 0) / count).toFixed(1)),
  avgScore: Math.round(results.reduce((s, r) => s + r.score, 0) / count),
  stageHistogram: stages,
  byMap,
  sample: results.slice(0, 8)
}, null, 2));
