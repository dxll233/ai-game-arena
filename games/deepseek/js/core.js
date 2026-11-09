/*
 * 《长夜点灯》核心规则
 * 不依赖 DOM / Canvas / WebAudio，可在浏览器与 Node 中运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NightCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '2.0.0';

  var BALANCE = Object.freeze({
    WORLD_W: 1280,
    WORLD_H: 720,
    BOUNDS: Object.freeze({ left: 48, top: 58, right: 1232, bottom: 662 }),

    PLAYER_START_X: 640,
    PLAYER_START_Y: 506,
    PLAYER_SPEED: 198,
    PLAYER_RADIUS: 15,
    PLAYER_MAX_HP: 4,
    BASE_LIGHT_RADIUS: 92,
    BASE_LIGHT_DPS: 2,

    OIL_MAX: 100,
    OIL_START: 72,
    BEAM_RANGE: 330,
    BEAM_HALF_ANGLE: 21 * Math.PI / 180,
    BEAM_DPS: 21,
    BEAM_OIL_PER_SEC: 18,
    BEAM_SLOW: 0.35,
    FOCUS_SPEED_MULT: 0.85,

    DASH_SPEED: 737.5,
    DASH_TIME: 0.16,
    DASH_COOLDOWN: 2.5,
    DASH_IFRAME: 0.18,
    HIT_IFRAME: 1.1,
    HIT_KNOCKBACK: 28,
    ENEMY_KNOCKBACK: 20,

    BRAZIER_INTERACT_RADIUS: 82,
    BRAZIER_IGNITE_TIME: 1.8,
    BRAZIER_IGNITE_COST: 15,
    BRAZIER_RESTORE_OIL: 30,
    BRAZIER_AURA_RADIUS: 110,
    BRAZIER_AURA_DPS: 5,
    BRAZIER_AURA_SLOW: 0.30,
    BRAZIER_AURA_REGEN: 3,

    LIGHTHOUSE_X: 640,
    LIGHTHOUSE_Y: 360,
    LIGHTHOUSE_RADIUS: 46,
    LIGHTHOUSE_INTERACT_RADIUS: 105,
    LIGHTHOUSE_START_TIME: 0.8,

    NIGHT_DURATION: 300,
    FINALE_DURATION: 20,
    FINALE_DURATION_EXPEDITION: 30,
    FINALE_MIN_TIME: 45,
    FINALE_AURA_START: 120,
    FINALE_AURA_END: 210,
    FINALE_AURA_DPS: 6,
    FINALE_AURA_SLOW: 0.25,
    FINALE_AURA_REGEN: 3,
    FINALE_FIRST_SPAWN: 0.72,
    FINALE_SPAWN_INTERVAL: 0.58,

    MAX_ENEMIES: 46,
    MAX_PICKUPS: 10,
    SPAWN_GRACE: 4,
    PICKUP_TTL: 20,
    PICKUP_RADIUS: 30,
    PICKUP_OIL: 12,
    PICKUP_CHANCE: 0.26,

    BASE_SPAWN_SLOW: 1.9,
    BASE_SPAWN_FAST: 0.9,
    SPAWN_RAMP_TIME: 300,

    EXPEDITION_DURATION: 420,
    CARGO_PICKUP_RADIUS: 38,
    CARGO_DELIVER_RADIUS: 108,
    CARGO_SPEED_MULT: 0.88,
    CARGO_DROP_COOLDOWN: 0.9,
    THIEF_STEAL_TIME: 1.4,
    THIEF_SUPPRESS_TIME: 7,
    FOG_RADIUS: 82,
    FOG_TTL: 7,
    FOG_HP: 16,
    FOG_SLOW: 0.48,
    FOG_OIL_DRAIN: 1.4,
    FOG_WINDUP: 1.1,
    FOG_COOLDOWN: 4.2,
    MAX_FOG_ZONES: 8
  });

  var MAPS = Object.freeze({
    village: Object.freeze({
      key: 'village',
      name: '旧村四角',
      short: '熟悉的四角旧村',
      risk: '均衡',
      description: '四盏旧灯分布在村庄四角，路线直白，适合短夜巡守。',
      theme: 'village',
      spawnRateMult: 1,
      startX: 640,
      startY: 506,
      river: null,
      cargoPoints: Object.freeze([
        { x: 1100, y: 610 }, { x: 180, y: 190 }, { x: 640, y: 92 },
        { x: 120, y: 640 }, { x: 1160, y: 92 }
      ]),
      thiefPoints: Object.freeze([{ x: 900, y: 600 }, { x: 380, y: 180 }, { x: 1120, y: 360 }]),
      weaverPoints: Object.freeze([{ x: 340, y: 300 }, { x: 940, y: 440 }, { x: 640, y: 610 }]),
      braziers: Object.freeze([
        { id: 'north', name: '北岭灯', x: 202, y: 176 },
        { id: 'east', name: '东渡灯', x: 1078, y: 176 },
        { id: 'west', name: '西林灯', x: 202, y: 554 },
        { id: 'south', name: '南岸灯', x: 1078, y: 554 }
      ])
    }),
    forest: Object.freeze({
      key: 'forest',
      name: '林间环路',
      short: '捷径最短，暗影最密',
      risk: '高压',
      description: '四灯围成林间环路，赶路更快，但暗影生成更频繁。',
      theme: 'forest',
      spawnRateMult: 1.2,
      startX: 640,
      startY: 498,
      river: null,
      cargoPoints: Object.freeze([
        { x: 1060, y: 560 }, { x: 220, y: 200 }, { x: 640, y: 650 },
        { x: 120, y: 560 }, { x: 1160, y: 120 }
      ]),
      thiefPoints: Object.freeze([{ x: 980, y: 470 }, { x: 300, y: 250 }, { x: 640, y: 100 }]),
      weaverPoints: Object.freeze([{ x: 300, y: 250 }, { x: 980, y: 470 }, { x: 500, y: 590 }]),
      braziers: Object.freeze([
        { id: 'ring-north', name: '北环灯', x: 640, y: 138 },
        { id: 'ring-east', name: '东环灯', x: 1086, y: 360 },
        { id: 'ring-west', name: '西环灯', x: 194, y: 360 },
        { id: 'ring-south', name: '南环灯', x: 640, y: 588 }
      ])
    }),
    river: Object.freeze({
      key: 'river',
      name: '冻河折线',
      short: '桥是捷径，涉水会失温',
      risk: '路线',
      description: '冻河横贯村庄，两座窄桥连接南北。涉水更慢，还会流失灯油。',
      theme: 'river',
      spawnRateMult: 0.95,
      startX: 640,
      startY: 626,
      river: Object.freeze({
        yMin: 470,
        yMax: 550,
        wadeSlow: 0.56,
        oilDrain: 1.5,
        bridges: Object.freeze([
          Object.freeze({ xMin: 300, xMax: 410 }),
          Object.freeze({ xMin: 870, xMax: 980 })
        ])
      }),
      cargoPoints: Object.freeze([
        { x: 1090, y: 616 }, { x: 190, y: 154 }, { x: 640, y: 110 },
        { x: 640, y: 650 }, { x: 1160, y: 560 }
      ]),
      thiefPoints: Object.freeze([{ x: 980, y: 610 }, { x: 300, y: 164 }, { x: 1080, y: 300 }]),
      weaverPoints: Object.freeze([{ x: 360, y: 330 }, { x: 920, y: 330 }, { x: 640, y: 610 }]),
      braziers: Object.freeze([
        { id: 'river-northwest', name: '北岸灯', x: 200, y: 154 },
        { id: 'river-northeast', name: '东岸灯', x: 1080, y: 154 },
        { id: 'river-southwest', name: '西桥灯', x: 210, y: 604 },
        { id: 'river-southeast', name: '南桥灯', x: 1070, y: 604 }
      ])
    })
  });

  var BRAZIER_DEFS = MAPS.village.braziers;

  var MODES = Object.freeze({
    short: Object.freeze({
      key: 'short',
      name: '短夜巡守',
      duration: 300,
      description: '四灯、返塔、二十秒守夜。第一轮的完整短篇。'
    }),
    expedition: Object.freeze({
      key: 'expedition',
      name: '远征长夜',
      duration: 420,
      description: '四灯之后继续运送灯油、猎杀携灯影，逐段唤醒长灯。'
    })
  });

  var LIGHTHOUSE_TYPES = Object.freeze({
    classic: Object.freeze({
      key: 'classic',
      name: '旧灯',
      tag: '基准',
      advantage: '第一轮原样数值',
      drawback: '仅用于兼容旧测试',
      accent: '#ffc879',
      beamDpsMult: 1,
      beamOilMult: 1,
      auraRadiusBonus: 0,
      auraDpsBonus: 0,
      auraRegenBonus: 0,
      igniteMult: 1,
      maxOilBonus: 0,
      showGuide: false,
      selectable: false
    }),
    ember: Object.freeze({
      key: 'ember',
      name: '回油灯',
      tag: '续航',
      advantage: '古灯光环回油 +2/秒',
      drawback: '灯火伤害 -15%',
      accent: '#ffad5f',
      beamDpsMult: 0.85,
      beamOilMult: 1,
      auraRadiusBonus: 0,
      auraDpsBonus: 0,
      auraRegenBonus: 2,
      igniteMult: 1,
      maxOilBonus: 0,
      showGuide: false,
      selectable: true
    }),
    ward: Object.freeze({
      key: 'ward',
      name: '守夜灯',
      tag: '守护',
      advantage: '古灯光环半径 +25、伤害 +2',
      drawback: '灯火油耗 +15%',
      accent: '#ffe0a0',
      beamDpsMult: 1,
      beamOilMult: 1.15,
      auraRadiusBonus: 25,
      auraDpsBonus: 2,
      auraRegenBonus: 0,
      igniteMult: 1,
      maxOilBonus: 0,
      showGuide: false,
      selectable: true
    }),
    guide: Object.freeze({
      key: 'guide',
      name: '引路灯',
      tag: '寻路',
      advantage: '显示目标方向、点灯快 20%',
      drawback: '灯油上限 -12',
      accent: '#9fe0d4',
      beamDpsMult: 1,
      beamOilMult: 1,
      auraRadiusBonus: 0,
      auraDpsBonus: 0,
      auraRegenBonus: 0,
      igniteMult: 0.8,
      maxOilBonus: -12,
      showGuide: true,
      selectable: true
    })
  });

  var ENEMY_TYPES = Object.freeze({
    wisp: Object.freeze({
      key: 'wisp', name: '游影', hp: 3, speed: 100, radius: 9,
      damage: 1, score: 10, knockbackScale: 1
    }),
    wraith: Object.freeze({
      key: 'wraith', name: '夜行', hp: 6, speed: 70, radius: 13,
      damage: 1, score: 20, knockbackScale: 0.8
    }),
    brute: Object.freeze({
      key: 'brute', name: '渊影', hp: 14, speed: 42, radius: 21,
      damage: 2, score: 60, knockbackScale: 0.35
    }),
    thief: Object.freeze({
      key: 'thief', name: '携灯影', hp: 12, speed: 72, radius: 14,
      damage: 1, score: 90, knockbackScale: 0.7, behavior: 'thief'
    }),
    weaver: Object.freeze({
      key: 'weaver', name: '缠雾者', hp: 10, speed: 54, radius: 15,
      damage: 1, score: 75, knockbackScale: 0.7, behavior: 'weaver'
    })
  });

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function length(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function normalize(x, y) {
    var len = length(x, y);
    if (len < 0.000001) return { x: 0, y: 0, len: 0 };
    return { x: x / len, y: y / len, len: len };
  }

  /* ---------------- 可复现随机数 ---------------- */

  function hashSeed(seed) {
    var value = Number(seed);
    if (!Number.isFinite(value)) value = 0x9e3779b9;
    value = value >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return value >>> 0 || 0x9e3779b9;
  }

  function rand(state) {
    var t = (state.rngState = (state.rngState + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randRange(state, min, max) {
    return min + rand(state) * (max - min);
  }

  function pickWeighted(state, entries) {
    var total = 0;
    var i;
    for (i = 0; i < entries.length; i++) total += entries[i].weight;
    var roll = rand(state) * total;
    for (i = 0; i < entries.length; i++) {
      roll -= entries[i].weight;
      if (roll <= 0) return entries[i].value;
    }
    return entries[entries.length - 1].value;
  }

  /* ---------------- 创建游戏 ---------------- */

  function createGame(options) {
    options = options || {};
    var seed = options.seed === undefined ? (Date.now() >>> 0) : options.seed;
    var modeKey = MODES[options.mode] ? options.mode : 'short';
    var mapKey = MAPS[options.mapId] ? options.mapId : 'village';
    var lighthouseKey = LIGHTHOUSE_TYPES[options.lighthouseType] ? options.lighthouseType : 'classic';
    var mode = MODES[modeKey];
    var map = MAPS[mapKey];
    var lighthouseType = LIGHTHOUSE_TYPES[lighthouseKey];
    var maxOil = BALANCE.OIL_MAX + lighthouseType.maxOilBonus;
    var expedition = modeKey === 'expedition' ? {
      stage: 1,
      stageTitle: '四灯',
      delivered: 0,
      deliveriesRequired: 5,
      deliveriesDone: 0,
      cargo: null,
      cargoIndex: 0,
      cargoDrops: 0,
      thievesKilled: 0,
      thievesRequired: 3,
      thievesSpawned: false,
      weaversKilled: 0,
      weaversRequired: 3,
      weaversSpawned: false,
      stageStartedAt: 0,
      fogHintShown: false,
      thiefHintShown: false
    } : null;

    var state = {
      version: VERSION,
      seed: seed,
      rngState: hashSeed(seed),
      mode: modeKey,
      mapId: mapKey,
      lighthouseType: lighthouseKey,
      phase: 'playing',
      elapsed: 0,
      timeLeft: mode.duration,
      finaleTime: 0,
      finaleDuration: modeKey === 'expedition' ? BALANCE.FINALE_DURATION_EXPEDITION : BALANCE.FINALE_DURATION,
      finaleLastTick: 99,
      score: 0,
      kills: 0,
      oilCollected: 0,
      braziersLit: 0,
      events: [],
      spawnTimer: BALANCE.SPAWN_GRACE,
      nextEnemyId: 1,
      nextFogId: 1,
      fogZones: [],
      expedition: expedition,
      flags: {
        allLitAnnounced: false,
        lowOilAnnounced: false,
        lowOilCooldown: 0
      },
      player: {
        x: map.startX,
        y: map.startY,
        aimX: 0,
        aimY: -1,
        hp: BALANCE.PLAYER_MAX_HP,
        maxHp: BALANCE.PLAYER_MAX_HP,
        oil: Math.min(BALANCE.OIL_START, maxOil),
        maxOil: maxOil,
        invuln: 0,
        dashCooldown: 0,
        dashTime: 0,
        dashDirX: 0,
        dashDirY: -1,
        focusing: false,
        beamActive: false,
        moving: false,
        moveX: 0,
        moveY: 0,
        hitFlash: 0,
        carrying: false,
        wading: false,
        fogged: false
      },
      lighthouse: {
        x: BALANCE.LIGHTHOUSE_X,
        y: BALANCE.LIGHTHOUSE_Y,
        progress: 0,
        auraRadius: 0,
        pulse: 0
      },
      braziers: map.braziers.map(function (def, index) {
        return {
          id: def.id,
          name: def.name,
          x: def.x,
          y: def.y,
          index: index,
          lit: false,
          progress: 0,
          pulse: 0,
          flare: 0,
          suppressed: 0,
          stolenBy: null
        };
      }),
      enemies: [],
      pickups: [],
      stats: {
        braziersLit: 0,
        oilCollected: 0,
        damageTaken: 0,
        dashes: 0,
        finaleSurvived: 0,
        cargoDelivered: 0,
        thievesSlain: 0,
        fogCleared: 0,
        weaversSlain: 0,
        stageBonuses: 0
      }
    };
    return state;
  }

  /* ---------------- 配置与数值查询 ---------------- */

  function getMapConfig(state) {
    return MAPS[state.mapId] || MAPS.village;
  }

  function getModeConfig(state) {
    return MODES[state.mode] || MODES.short;
  }

  function getLighthouseConfig(state) {
    return LIGHTHOUSE_TYPES[state.lighthouseType] || LIGHTHOUSE_TYPES.classic;
  }

  function getBeamDps(state) {
    return BALANCE.BEAM_DPS * getLighthouseConfig(state).beamDpsMult;
  }

  function getBeamOilPerSec(state) {
    return BALANCE.BEAM_OIL_PER_SEC * getLighthouseConfig(state).beamOilMult;
  }

  function getBrazierAuraRadius(state) {
    return BALANCE.BRAZIER_AURA_RADIUS + getLighthouseConfig(state).auraRadiusBonus;
  }

  function getBrazierAuraDps(state) {
    return BALANCE.BRAZIER_AURA_DPS + getLighthouseConfig(state).auraDpsBonus;
  }

  function getBrazierAuraRegen(state) {
    return BALANCE.BRAZIER_AURA_REGEN + getLighthouseConfig(state).auraRegenBonus;
  }

  function getIgniteTime(state) {
    return BALANCE.BRAZIER_IGNITE_TIME * getLighthouseConfig(state).igniteMult;
  }

  function isOnBridge(map, x) {
    if (!map.river) return false;
    for (var i = 0; i < map.river.bridges.length; i++) {
      var bridge = map.river.bridges[i];
      if (x >= bridge.xMin && x <= bridge.xMax) return true;
    }
    return false;
  }

  function isInRiver(map, x, y) {
    if (!map.river) return false;
    return y >= map.river.yMin && y <= map.river.yMax && !isOnBridge(map, x);
  }

  function isInFog(state, x, y) {
    for (var i = 0; i < state.fogZones.length; i++) {
      var fog = state.fogZones[i];
      if (length(x - fog.x, y - fog.y) <= fog.radius) return true;
    }
    return false;
  }

  function getObjectiveTargets(state) {
    var targets = [];
    var i;
    if (state.phase === 'victory' || state.phase === 'defeat') return targets;
    if (state.phase === 'finale') {
      targets.push({ x: state.lighthouse.x, y: state.lighthouse.y, kind: 'lighthouse', label: '长灯' });
      return targets;
    }

    if (state.mode === 'expedition' && state.expedition) {
      var stage = state.expedition.stage;
      if (stage === 1) {
        for (i = 0; i < state.braziers.length; i++) {
          if (!state.braziers[i].lit) {
            targets.push({ x: state.braziers[i].x, y: state.braziers[i].y, kind: 'brazier', label: state.braziers[i].name });
          }
        }
        return targets;
      }
      if (stage === 2) {
        if (state.expedition.cargo && !state.expedition.cargo.carried) {
          targets.push({ x: state.expedition.cargo.x, y: state.expedition.cargo.y, kind: 'cargo', label: '长灯油' });
        } else {
          targets.push({ x: state.lighthouse.x, y: state.lighthouse.y, kind: 'lighthouse', label: '长灯' });
        }
        return targets;
      }
      if (stage === 3) {
        for (i = 0; i < state.enemies.length; i++) {
          if (state.enemies[i].type === 'thief' && !state.enemies[i].dead && state.enemies[i].quest) {
            targets.push({ x: state.enemies[i].x, y: state.enemies[i].y, kind: 'thief', label: '携灯影' });
          }
        }
        return targets;
      }
      if (stage === 4) {
        for (i = 0; i < state.enemies.length; i++) {
          if (state.enemies[i].type === 'weaver' && !state.enemies[i].dead && state.enemies[i].quest) {
            targets.push({ x: state.enemies[i].x, y: state.enemies[i].y, kind: 'weaver', label: '缠雾者' });
          }
        }
        return targets;
      }
      targets.push({ x: state.lighthouse.x, y: state.lighthouse.y, kind: 'lighthouse', label: '长灯' });
      return targets;
    }

    var lit = getLitCount(state);
    if (lit < state.braziers.length) {
      for (i = 0; i < state.braziers.length; i++) {
        if (!state.braziers[i].lit) {
          targets.push({ x: state.braziers[i].x, y: state.braziers[i].y, kind: 'brazier', label: state.braziers[i].name });
        }
      }
    } else {
      targets.push({ x: state.lighthouse.x, y: state.lighthouse.y, kind: 'lighthouse', label: '长灯' });
    }
    return targets;
  }

  function getLitCount(state) {
    var count = 0;
    for (var i = 0; i < state.braziers.length; i++) {
      if (state.braziers[i].lit) count++;
    }
    return count;
  }

  function getNearestBrazier(state, includeLit) {
    var player = state.player;
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < state.braziers.length; i++) {
      var brazier = state.braziers[i];
      if (!includeLit && brazier.lit) continue;
      var dx = brazier.x - player.x;
      var dy = brazier.y - player.y;
      var distance = length(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { brazier: brazier, distance: distance };
      }
    }
    return best;
  }

  function getLighthouseDistance(state) {
    var player = state.player;
    return length(
      player.x - state.lighthouse.x,
      player.y - state.lighthouse.y
    );
  }

  function getInteractTarget(state) {
    if (state.phase !== 'playing') return null;
    var litCount = getLitCount(state);
    if (litCount < state.braziers.length) {
      var nearest = getNearestBrazier(state, false);
      if (nearest && nearest.distance <= BALANCE.BRAZIER_INTERACT_RADIUS) {
        return {
          type: 'brazier',
          brazier: nearest.brazier,
          distance: nearest.distance,
          progress: nearest.brazier.progress / getIgniteTime(state),
          canInteract: state.player.oil >= BALANCE.BRAZIER_IGNITE_COST
        };
      }
      return null;
    }
    if (state.mode === 'expedition' && (!state.expedition || state.expedition.stage < 5)) {
      return null;
    }
    var lighthouseDistance = getLighthouseDistance(state);
    if (lighthouseDistance <= BALANCE.LIGHTHOUSE_INTERACT_RADIUS) {
      return {
        type: 'lighthouse',
        distance: lighthouseDistance,
        progress: state.lighthouse.progress / BALANCE.LIGHTHOUSE_START_TIME,
        canInteract: true
      };
    }
    return null;
  }

  function isInteractable(state) {
    var target = getInteractTarget(state);
    return !!(target && target.canInteract);
  }

  function getObjective(state) {
    if (state.phase === 'victory') return '黎明已至';
    if (state.phase === 'defeat') return '长夜未央';
    if (state.phase === 'finale') return '守住长灯，直到黎明';
    var lit = getLitCount(state);
    if (state.mode === 'expedition' && state.expedition) {
      var stage = state.expedition.stage;
      if (stage === 1) {
        return lit <= 0 ? '点亮四座古灯（0 / 4）' : '点亮四座古灯（' + lit + ' / 4）';
      }
      if (stage === 2) {
        if (state.expedition.cargo && state.expedition.cargo.carried) {
          return '将灯油送回长灯（' + state.expedition.delivered + ' / ' + state.expedition.deliveriesRequired + '）';
        }
        return '寻回长灯油（' + state.expedition.delivered + ' / ' + state.expedition.deliveriesRequired + '）';
      }
      if (stage === 3) {
        return '击败携灯影，夺回灯芯（' + state.expedition.thievesKilled + ' / ' + state.expedition.thievesRequired + '）';
      }
      if (stage === 4) {
        return '驱散缠雾者，清理雾带（' + state.expedition.weaversKilled + ' / ' + state.expedition.weaversRequired + '）';
      }
      return '回到长灯，唤醒黎明';
    }
    if (lit <= 0) return '点亮四座古灯（0 / 4）';
    if (lit < state.braziers.length) return '点亮余下的古灯（' + lit + ' / 4）';
    return '回到中央灯塔，唤醒长灯';
  }

  function emit(state, type, data) {
    var event = { type: type };
    if (data) {
      for (var key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) event[key] = data[key];
      }
    }
    state.events.push(event);
    return event;
  }

  function applyDamageToPlayer(state, amount, sourceX, sourceY) {
    var player = state.player;
    if (player.invuln > 0 || state.phase === 'victory' || state.phase === 'defeat') return false;
    player.hp = Math.max(0, player.hp - amount);
    player.invuln = BALANCE.HIT_IFRAME;
    player.hitFlash = 0.28;
    state.stats.damageTaken += amount;

    var nx = player.x - sourceX;
    var ny = player.y - sourceY;
    var n = normalize(nx, ny);
    if (n.len === 0) {
      n.x = 0;
      n.y = 1;
    }
    player.x += n.x * BALANCE.HIT_KNOCKBACK;
    player.y += n.y * BALANCE.HIT_KNOCKBACK;
    clampPlayerPosition(state);

    if (state.expedition && state.expedition.cargo && state.expedition.cargo.carried) {
      var cargo = state.expedition.cargo;
      cargo.carried = false;
      cargo.x = player.x;
      cargo.y = player.y;
      cargo.pickupCooldown = BALANCE.CARGO_DROP_COOLDOWN;
      player.carrying = false;
      state.expedition.cargoDrops++;
      emit(state, 'cargo-dropped', { x: cargo.x, y: cargo.y });
    }

    emit(state, 'player-hit', {
      damage: amount,
      x: player.x,
      y: player.y,
      hp: player.hp
    });

    if (player.hp <= 0) {
      state.phase = 'defeat';
      emit(state, 'defeat', { reason: 'health', elapsed: state.elapsed, score: state.score });
    }
    return true;
  }

  function clampPlayerPosition(state) {
    var player = state.player;
    player.x = clamp(player.x, BALANCE.BOUNDS.left, BALANCE.BOUNDS.right);
    player.y = clamp(player.y, BALANCE.BOUNDS.top, BALANCE.BOUNDS.bottom);
  }

  function resolveLighthouseCollision(state) {
    var player = state.player;
    var lighthouse = state.lighthouse;
    var dx = player.x - lighthouse.x;
    var dy = player.y - lighthouse.y;
    var minDistance = BALANCE.LIGHTHOUSE_RADIUS + BALANCE.PLAYER_RADIUS;
    var distance = length(dx, dy);
    if (distance >= minDistance) return;
    if (distance < 0.001) {
      player.y = lighthouse.y + minDistance;
      return;
    }
    player.x = lighthouse.x + (dx / distance) * minDistance;
    player.y = lighthouse.y + (dy / distance) * minDistance;
  }

  /* ---------------- 玩家 ---------------- */

  function updatePlayer(state, dt, input) {
    var player = state.player;
    var move = normalize(input.moveX || 0, input.moveY || 0);
    if (move.len > 1) {
      move.x /= move.len;
      move.y /= move.len;
      move.len = 1;
    }

    player.moveX = move.x;
    player.moveY = move.y;
    player.moving = move.len > 0.08;

    if (input.aimX !== undefined && input.aimY !== undefined) {
      var aim = normalize(input.aimX, input.aimY);
      if (aim.len > 0.001) {
        player.aimX = aim.x;
        player.aimY = aim.y;
      }
    }

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt);
    if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);

    if (input.dash && player.dashCooldown <= 0 && (state.phase === 'playing' || state.phase === 'finale')) {
      var dashDir;
      if (move.len > 0.15) {
        dashDir = { x: move.x, y: move.y };
      } else {
        dashDir = { x: -player.aimX, y: -player.aimY };
      }
      player.dashDirX = dashDir.x;
      player.dashDirY = dashDir.y;
      player.dashTime = BALANCE.DASH_TIME;
      player.dashCooldown = BALANCE.DASH_COOLDOWN;
      player.invuln = Math.max(player.invuln, BALANCE.DASH_IFRAME);
      state.stats.dashes++;
      emit(state, 'dash', { x: player.x, y: player.y });
    }

    if (player.dashTime > 0) {
      var dashStep = Math.min(dt, player.dashTime);
      var distance = BALANCE.DASH_SPEED * dashStep;
      player.x += player.dashDirX * distance;
      player.y += player.dashDirY * distance;
      player.dashTime = Math.max(0, player.dashTime - dt);
    } else {
      var map = getMapConfig(state);
      player.wading = isInRiver(map, player.x, player.y);
      player.fogged = isInFog(state, player.x, player.y);
      var speed = BALANCE.PLAYER_SPEED * (player.focusing ? BALANCE.FOCUS_SPEED_MULT : 1);
      if (player.carrying) speed *= BALANCE.CARGO_SPEED_MULT;
      if (player.wading) speed *= map.river.wadeSlow;
      if (player.fogged) speed *= 1 - BALANCE.FOG_SLOW;
      player.x += move.x * speed * dt;
      player.y += move.y * speed * dt;
    }

    resolveLighthouseCollision(state);
    clampPlayerPosition(state);

    var currentMap = getMapConfig(state);
    player.wading = isInRiver(currentMap, player.x, player.y);
    player.fogged = isInFog(state, player.x, player.y);
    if (player.wading) {
      player.oil = Math.max(0, player.oil - currentMap.river.oilDrain * dt);
    }
    if (player.fogged) {
      player.oil = Math.max(0, player.oil - BALANCE.FOG_OIL_DRAIN * dt);
    }

    player.focusing = !!input.focus;
    var wantsBeam = player.focusing && player.oil > 0 && state.phase !== 'defeat' && state.phase !== 'victory';
    if (wantsBeam) {
      player.oil = Math.max(0, player.oil - getBeamOilPerSec(state) * dt);
      player.beamActive = player.oil > 0;
    } else {
      player.beamActive = false;
    }

    if (player.focusing && player.oil <= 0) {
      state.flags.lowOilCooldown = Math.max(0, state.flags.lowOilCooldown - dt);
      if (!state.flags.lowOilAnnounced && state.flags.lowOilCooldown <= 0) {
        state.flags.lowOilAnnounced = true;
        state.flags.lowOilCooldown = 4;
        emit(state, 'oil-empty', { x: player.x, y: player.y });
      }
    } else if (player.oil > 8) {
      state.flags.lowOilAnnounced = false;
    }
  }

  /* ---------------- 古灯与灯塔 ---------------- */

  function updateInteraction(state, dt, input) {
    var player = state.player;
    var litCount = getLitCount(state);

    if (litCount < state.braziers.length) {
      state.lighthouse.progress = Math.max(0, state.lighthouse.progress - dt * 0.5);
      var nearest = getNearestBrazier(state, false);
      var target = nearest && nearest.distance <= BALANCE.BRAZIER_INTERACT_RADIUS ? nearest.brazier : null;

      for (var i = 0; i < state.braziers.length; i++) {
        var brazier = state.braziers[i];
        if (!brazier.lit && brazier !== target) {
          brazier.progress = Math.max(0, brazier.progress - dt * 0.5);
        }
      }

      if (target) {
        var igniteTime = getIgniteTime(state);
        if (input.interact && player.oil >= BALANCE.BRAZIER_IGNITE_COST) {
          target.progress += dt;
          if (target.progress >= igniteTime) {
            igniteBrazier(state, target);
          }
        } else {
          target.progress = Math.max(0, target.progress - dt * 0.5);
          if (input.interact && player.oil < BALANCE.BRAZIER_IGNITE_COST) {
            state.flags.lowOilCooldown = Math.max(0, state.flags.lowOilCooldown - dt);
            if (state.flags.lowOilCooldown <= 0) {
              state.flags.lowOilCooldown = 3;
              emit(state, 'oil-empty', { x: target.x, y: target.y, reason: 'ignite' });
            }
          }
        }
      }
      return;
    }

    if (litCount === state.braziers.length) {
      if (!state.flags.allLitAnnounced) {
        state.flags.allLitAnnounced = true;
        emit(state, 'all-lit', {});
      }
      var canWake = state.mode !== 'expedition' ||
        (state.expedition && state.expedition.stage === 5);
      var distance = getLighthouseDistance(state);
      if (canWake && distance <= BALANCE.LIGHTHOUSE_INTERACT_RADIUS && input.interact) {
        state.lighthouse.progress += dt;
        state.lighthouse.pulse = Math.max(state.lighthouse.pulse, 0.5);
        if (state.lighthouse.progress >= BALANCE.LIGHTHOUSE_START_TIME) {
          startFinale(state);
        }
      } else {
        state.lighthouse.progress = Math.max(0, state.lighthouse.progress - dt * 0.45);
      }
    }
  }

  function igniteBrazier(state, brazier) {
    var player = state.player;
    if (brazier.lit) return;
    player.oil = Math.max(0, player.oil - BALANCE.BRAZIER_IGNITE_COST);
    player.oil = Math.min(player.maxOil, player.oil + BALANCE.BRAZIER_RESTORE_OIL);
    player.hp = Math.min(player.maxHp, player.hp + 1);
    brazier.lit = true;
    brazier.progress = getIgniteTime(state);
    brazier.pulse = 1;
    brazier.flare = 1;
    state.braziersLit = getLitCount(state);
    state.stats.braziersLit = state.braziersLit;
    state.score += 100;
    emit(state, 'brazier-lit', {
      id: brazier.id,
      name: brazier.name,
      x: brazier.x,
      y: brazier.y,
      litCount: state.braziersLit
    });
    if (state.braziersLit === state.braziers.length) {
      /* 四灯皆亮后保证返塔与最终守夜有公平窗口 */
      state.timeLeft = Math.max(state.timeLeft, BALANCE.FINALE_MIN_TIME);
      if (!state.flags.allLitAnnounced) {
        state.flags.allLitAnnounced = true;
        emit(state, 'all-lit', {});
      }
      if (state.mode === 'expedition' && state.expedition && state.expedition.stage === 1) {
        startExpeditionStage(state, 2);
      }
    }
  }

  function startFinale(state) {
    if (state.phase !== 'playing') return;
    state.phase = 'finale';
    state.finaleTime = 0;
    state.finaleLastTick = 99;
    state.timeLeft = Math.max(state.timeLeft, BALANCE.FINALE_MIN_TIME);
    state.lighthouse.progress = 0;
    state.lighthouse.pulse = 1;
    state.lighthouse.auraRadius = BALANCE.FINALE_AURA_START;
    state.spawnTimer = Math.min(state.spawnTimer, 0.25);
    emit(state, 'lighthouse-start', {
      x: state.lighthouse.x,
      y: state.lighthouse.y
    });
  }

  /* ---------------- 远征阶段 ---------------- */

  function spawnCargo(state, index) {
    var map = getMapConfig(state);
    var point = map.cargoPoints[index] || map.cargoPoints[0];
    state.expedition.cargoIndex = index;
    state.expedition.cargo = {
      x: point.x,
      y: point.y,
      index: index,
      carried: false,
      pickupCooldown: 0
    };
    state.player.carrying = false;
    emit(state, 'cargo-spawned', { x: point.x, y: point.y, index: index });
  }

  function startExpeditionStage(state, nextStage) {
    if (!state.expedition) return;
    var ex = state.expedition;
    if (nextStage <= ex.stage) return;
    ex.stage = nextStage;
    ex.stageStartedAt = state.elapsed;
    var map = getMapConfig(state);
    if (nextStage >= 2) {
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
      state.player.oil = Math.min(state.player.maxOil, state.player.oil + 20);
      /* 长灯换段时清场：普通暗影退去，新阶段只留下任务敌人与新生成。 */
      state.enemies = state.enemies.filter(function (enemy) { return enemy.quest && !enemy.dead; });
      state.spawnTimer = Math.max(state.spawnTimer, 1.2);
      emit(state, 'stage-pulse', {
        x: state.lighthouse.x,
        y: state.lighthouse.y,
        stage: nextStage
      });
    }

    if (nextStage === 2) {
      ex.stageTitle = '灯油';
      ex.delivered = 0;
      ex.cargo = null;
      spawnCargo(state, 0);
      state.score += 150;
      state.stats.stageBonuses += 150;
      emit(state, 'expedition-stage', {
        stage: 2,
        title: '夺回长灯油',
        detail: '把五罐灯油送回长灯'
      });
    } else if (nextStage === 3) {
      ex.stageTitle = '追灯';
      ex.thievesKilled = 0;
      ex.thievesSpawned = true;
      ex.cargo = null;
      state.player.carrying = false;
      var thiefPoint = map.thiefPoints[0];
      spawnEnemy(state, 'thief', {
        x: thiefPoint.x,
        y: thiefPoint.y,
        quest: true,
        elite: true,
        hpMult: 1.5,
        force: true
      });
      state.score += 200;
      state.stats.stageBonuses += 200;
      emit(state, 'expedition-stage', {
        stage: 3,
        title: '追回被窃灯火',
        detail: '击败三名携灯影，别让它们熄灭古灯'
      });
    } else if (nextStage === 4) {
      ex.stageTitle = '清雾';
      ex.weaversKilled = 0;
      ex.weaversSpawned = true;
      var weaverPoint = map.weaverPoints[0];
      spawnEnemy(state, 'weaver', {
        x: weaverPoint.x,
        y: weaverPoint.y,
        quest: true,
        elite: true,
        hpMult: 1.35,
        fogCooldown: 0.35,
        force: true
      });
      state.fogZones.length = 0;
      state.score += 200;
      state.stats.stageBonuses += 200;
      emit(state, 'expedition-stage', {
        stage: 4,
        title: '驱散缠雾者',
        detail: '击败三名缠雾者；先用灯火驱散它们布置的雾带'
      });
    } else if (nextStage === 5) {
      ex.stageTitle = '唤醒';
      ex.thievesSpawned = false;
      ex.weaversSpawned = false;
      for (var b = 0; b < state.braziers.length; b++) {
        if (state.braziers[b].suppressed > 0) {
          state.braziers[b].suppressed = 0;
          state.braziers[b].stolenBy = null;
          state.braziers[b].pulse = 1;
        }
      }
      state.fogZones.length = 0;
      state.timeLeft = Math.max(state.timeLeft, 60);
      state.score += 250;
      state.stats.stageBonuses += 250;
      emit(state, 'expedition-stage', {
        stage: 5,
        title: '黎明将至',
        detail: '回到长灯，按住交互唤醒黎明'
      });
    }
  }

  function updateExpedition(state, dt) {
    var ex = state.expedition;
    if (!ex) return;
    var player = state.player;
    var lighthouseDistance = getLighthouseDistance(state);

    if (ex.stage === 2) {
      var cargo = ex.cargo;
      if (cargo) {
        if (cargo.pickupCooldown > 0) {
          cargo.pickupCooldown = Math.max(0, cargo.pickupCooldown - dt);
        }
        if (!cargo.carried && cargo.pickupCooldown <= 0 &&
          length(player.x - cargo.x, player.y - cargo.y) <= BALANCE.CARGO_PICKUP_RADIUS) {
          cargo.carried = true;
          player.carrying = true;
          cargo.x = player.x;
          cargo.y = player.y;
          emit(state, 'cargo-picked', { x: cargo.x, y: cargo.y });
        }
        if (cargo.carried) {
          cargo.x = player.x;
          cargo.y = player.y;
          if (lighthouseDistance <= BALANCE.CARGO_DELIVER_RADIUS) {
            cargo.carried = false;
            player.carrying = false;
            ex.delivered++;
            ex.deliveriesDone++;
            state.stats.cargoDelivered++;
            state.score += 120;
            emit(state, 'cargo-delivered', {
              x: state.lighthouse.x,
              y: state.lighthouse.y,
              delivered: ex.delivered,
              required: ex.deliveriesRequired
            });
            if (ex.delivered >= ex.deliveriesRequired) {
              startExpeditionStage(state, 3);
            } else {
              spawnCargo(state, ex.delivered);
            }
          }
        }
      }
    }
  }

  function updateFogZones(state, dt) {
    if (!state.fogZones.length) return;
    var player = state.player;
    for (var i = state.fogZones.length - 1; i >= 0; i--) {
      var fog = state.fogZones[i];
      fog.age += dt;
      fog.ttl -= dt;
      if (fog.ttl <= 0) {
        state.fogZones.splice(i, 1);
        continue;
      }
      if (!player.beamActive) continue;
      var distance = length(fog.x - player.x, fog.y - player.y);
      if (distance > BALANCE.BEAM_RANGE + fog.radius) continue;
      if (distance > 12) {
        var vx = (fog.x - player.x) / distance;
        var vy = (fog.y - player.y) / distance;
        var dot = vx * player.aimX + vy * player.aimY;
        if (dot < Math.cos(BALANCE.BEAM_HALF_ANGLE)) continue;
      }
      fog.hp -= getBeamDps(state) * dt;
      if (fog.hp <= 0) {
        state.fogZones.splice(i, 1);
        state.score += 12;
        state.stats.fogCleared++;
        emit(state, 'fog-cleared', { x: fog.x, y: fog.y });
      }
    }
  }

  /* ---------------- 敌人 ---------------- */

  function spawnInterval(state) {
    if (state.phase === 'finale') return BALANCE.FINALE_SPAWN_INTERVAL;
    var progress = clamp(state.elapsed / BALANCE.SPAWN_RAMP_TIME, 0, 1);
    var base = lerp(BALANCE.BASE_SPAWN_SLOW, BALANCE.BASE_SPAWN_FAST, progress);
    var lit = getLitCount(state);
    var map = getMapConfig(state);
    return base / (1 + lit * 0.15) / map.spawnRateMult;
  }

  function chooseEnemyType(state) {
    var elapsed = state.elapsed;
    var expedition = state.mode === 'expedition' && state.expedition;
    var stage = expedition ? state.expedition.stage : 0;
    var entries;
    if (state.phase === 'finale') {
      entries = [
        { value: 'wisp', weight: 32 },
        { value: 'wraith', weight: 38 },
        { value: 'brute', weight: 30 }
      ];
      if (state.mode === 'expedition') {
        entries = [
          { value: 'wisp', weight: 28 },
          { value: 'wraith', weight: 35 },
          { value: 'brute', weight: 27 },
          { value: 'weaver', weight: 10 }
        ];
      }
    } else if (elapsed < 90) {
      entries = [
        { value: 'wisp', weight: 66 },
        { value: 'wraith', weight: 34 }
      ];
    } else if (elapsed < 180) {
      entries = [
        { value: 'wisp', weight: 50 },
        { value: 'wraith', weight: 35 },
        { value: 'brute', weight: 15 }
      ];
    } else {
      entries = [
        { value: 'wisp', weight: 40 },
        { value: 'wraith', weight: 35 },
        { value: 'brute', weight: 25 }
      ];
    }

    if (expedition && stage >= 2 && state.phase !== 'finale') {
      var weaverWeight = stage >= 3 ? 20 : 14;
      entries = entries.map(function (entry) {
        if (entry.value === 'brute') return { value: 'brute', weight: Math.max(8, entry.weight - 6) };
        return entry;
      });
      entries.push({ value: 'weaver', weight: weaverWeight });
    }
    return pickWeighted(state, entries);
  }

  function chooseSpawnPoint(state) {
    var player = state.player;
    var best = null;
    var bestScore = -Infinity;
    for (var attempt = 0; attempt < 6; attempt++) {
      var edge = Math.floor(rand(state) * 4);
      var x;
      var y;
      if (edge === 0) {
        x = randRange(state, 40, BALANCE.WORLD_W - 40);
        y = -randRange(state, 20, 70);
      } else if (edge === 1) {
        x = BALANCE.WORLD_W + randRange(state, 20, 70);
        y = randRange(state, 40, BALANCE.WORLD_H - 40);
      } else if (edge === 2) {
        x = randRange(state, 40, BALANCE.WORLD_W - 40);
        y = BALANCE.WORLD_H + randRange(state, 20, 70);
      } else {
        x = -randRange(state, 20, 70);
        y = randRange(state, 40, BALANCE.WORLD_H - 40);
      }
      var distance = length(x - player.x, y - player.y);
      var score = distance;
      if (distance < 260) score -= 5000;
      if (score > bestScore) {
        bestScore = score;
        best = { x: x, y: y };
      }
    }
    return best;
  }

  function spawnEnemy(state, forcedType, options) {
    options = options || {};
    var cap = options.force ? BALANCE.MAX_ENEMIES + 4 : BALANCE.MAX_ENEMIES;
    if (state.enemies.length >= cap) return null;
    var typeKey = forcedType || chooseEnemyType(state);
    var type = ENEMY_TYPES[typeKey];
    if (!type) return null;
    var point;
    if (options.x !== undefined && options.y !== undefined) {
      point = { x: options.x, y: options.y };
    } else {
      point = chooseSpawnPoint(state);
      var offsetX = randRange(state, -22, 22);
      var offsetY = randRange(state, -22, 22);
      point.x += offsetX * 0.25;
      point.y += offsetY * 0.25;
    }
    var hp = Math.round(type.hp * (options.hpMult || 1));
    var enemy = {
      id: state.nextEnemyId++,
      type: typeKey,
      name: type.name,
      x: point.x,
      y: point.y,
      hp: hp,
      maxHp: hp,
      radius: type.radius * (options.elite ? 1.12 : 1),
      speed: type.speed * randRange(state, 0.9, 1.1),
      damage: type.damage,
      score: type.score * (options.elite ? 2 : 1),
      knockbackScale: type.knockbackScale,
      age: 0,
      phase: randRange(state, 0, Math.PI * 2),
      flash: 0,
      hitTick: 0,
      slow: 0,
      slowFactor: 0,
      knockX: 0,
      knockY: 0,
      dead: false,
      quest: !!options.quest,
      elite: !!options.elite,
      channel: 0,
      channelBrazierId: null,
      stolen: false,
      stolenBrazierId: null,
      fogCooldown: options.fogCooldown !== undefined
        ? options.fogCooldown
        : BALANCE.FOG_COOLDOWN * (0.75 + rand(state) * 0.4),
      fogWindup: 0,
      fogTargetX: 0,
      fogTargetY: 0
    };
    state.enemies.push(enemy);
    emit(state, 'enemy-spawn', {
      x: enemy.x,
      y: enemy.y,
      enemyType: typeKey,
      quest: enemy.quest,
      elite: enemy.elite
    });
    return enemy;
  }

  function nearestStealTarget(state, enemy) {
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < state.braziers.length; i++) {
      var brazier = state.braziers[i];
      if (!brazier.lit || brazier.suppressed > 0) continue;
      var distance = length(brazier.x - enemy.x, brazier.y - enemy.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { brazier: brazier, distance: distance };
      }
    }
    return best;
  }

  function damageEnemy(state, enemy, amount, source) {
    if (enemy.dead) return;
    enemy.hp -= amount;
    if (enemy.hp <= 0) {
      enemy.dead = true;
      state.kills++;
      state.score += enemy.score;

      if (enemy.type === 'thief' && enemy.stolenBrazierId) {
        for (var bi = 0; bi < state.braziers.length; bi++) {
          if (state.braziers[bi].id !== enemy.stolenBrazierId) continue;
          state.braziers[bi].suppressed = 0;
          state.braziers[bi].stolenBy = null;
          state.braziers[bi].pulse = 1;
          emit(state, 'brazier-restored', {
            x: state.braziers[bi].x,
            y: state.braziers[bi].y,
            name: state.braziers[bi].name,
            cause: 'thief-slain'
          });
          break;
        }
        state.player.oil = Math.min(state.player.maxOil, state.player.oil + 10);
        emit(state, 'wick-recovered', { x: enemy.x, y: enemy.y });
      }

      if (enemy.type === 'thief' && state.expedition && enemy.quest && state.expedition.stage === 3) {
        state.expedition.thievesKilled = Math.min(state.expedition.thievesRequired, state.expedition.thievesKilled + 1);
        state.stats.thievesSlain++;
        emit(state, 'thief-slain', {
          x: enemy.x,
          y: enemy.y,
          killed: state.expedition.thievesKilled,
          required: state.expedition.thievesRequired
        });
        if (state.expedition.thievesKilled >= state.expedition.thievesRequired) {
          startExpeditionStage(state, 4);
        } else {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
          state.player.oil = Math.min(state.player.maxOil, state.player.oil + 10);
          state.enemies = state.enemies.filter(function (other) { return other.quest && !other.dead; });
          emit(state, 'stage-pulse', { x: enemy.x, y: enemy.y, stage: 3 });
          var nextThiefPoint = getMapConfig(state).thiefPoints[state.expedition.thievesKilled];
          spawnEnemy(state, 'thief', {
            x: nextThiefPoint.x,
            y: nextThiefPoint.y,
            quest: true,
            elite: true,
            hpMult: 1.5,
            force: true
          });
        }
      }

      if (enemy.type === 'weaver' && state.expedition && enemy.quest && state.expedition.stage === 4) {
        state.expedition.weaversKilled = Math.min(state.expedition.weaversRequired, state.expedition.weaversKilled + 1);
        state.stats.weaversSlain++;
        emit(state, 'weaver-slain', {
          x: enemy.x,
          y: enemy.y,
          killed: state.expedition.weaversKilled,
          required: state.expedition.weaversRequired
        });
        if (state.expedition.weaversKilled >= state.expedition.weaversRequired) {
          startExpeditionStage(state, 5);
        } else {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
          state.player.oil = Math.min(state.player.maxOil, state.player.oil + 10);
          state.enemies = state.enemies.filter(function (other) { return other.quest && !other.dead; });
          emit(state, 'stage-pulse', { x: enemy.x, y: enemy.y, stage: 4 });
          var nextWeaverPoint = getMapConfig(state).weaverPoints[state.expedition.weaversKilled];
          spawnEnemy(state, 'weaver', {
            x: nextWeaverPoint.x,
            y: nextWeaverPoint.y,
            quest: true,
            elite: true,
            hpMult: 1.35,
            fogCooldown: 0.35,
            force: true
          });
        }
      }

      if (enemy.type === 'weaver') {
        var hadFog = state.fogZones.length > 0;
        state.fogZones.length = 0;
        if (hadFog) {
          emit(state, 'fog-dissolved', { x: enemy.x, y: enemy.y });
        }
      }

      emit(state, 'enemy-killed', {
        x: enemy.x,
        y: enemy.y,
        enemyType: enemy.type,
        score: enemy.score
      });
      if (state.pickups.length < BALANCE.MAX_PICKUPS && rand(state) < BALANCE.PICKUP_CHANCE) {
        state.pickups.push({
          x: enemy.x,
          y: enemy.y,
          age: 0,
          ttl: BALANCE.PICKUP_TTL,
          amount: BALANCE.PICKUP_OIL
        });
      }
      return;
    }
    if (source !== 'glow' && enemy.hitTick <= 0) {
      enemy.flash = 0.12;
      enemy.hitTick = 0.35;
      emit(state, 'enemy-hit', {
        x: enemy.x,
        y: enemy.y,
        enemyType: enemy.type,
        source: source
      });
    } else {
      enemy.flash = Math.max(enemy.flash, 0.06);
    }
  }

  function updateEnemies(state, dt) {
    var player = state.player;
    var i;
    var j;

    if (state.phase === 'playing' || state.phase === 'finale') {
      var grace = state.phase === 'finale' || state.elapsed >= BALANCE.SPAWN_GRACE;
      if (grace) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          if (state.enemies.length < BALANCE.MAX_ENEMIES) {
            spawnEnemy(state);
            state.spawnTimer = spawnInterval(state);
          } else {
            state.spawnTimer = 0.25;
          }
        }
      } else {
        state.spawnTimer = Math.max(0, state.spawnTimer - dt);
      }
    }

    for (i = 0; i < state.enemies.length; i++) {
      var enemy = state.enemies[i];
      enemy.age += dt;
      if (enemy.flash > 0) enemy.flash = Math.max(0, enemy.flash - dt);
      if (enemy.hitTick > 0) enemy.hitTick = Math.max(0, enemy.hitTick - dt);

      var playerDx = player.x - enemy.x;
      var playerDy = player.y - enemy.y;
      var playerDistance = length(playerDx, playerDy);
      var targetX = player.x;
      var targetY = player.y;
      var stealTarget = null;
      var stationary = false;

      if (enemy.type === 'thief' && !enemy.stolen) {
        stealTarget = nearestStealTarget(state, enemy);
        if (stealTarget && stealTarget.distance < 700) {
          targetX = stealTarget.brazier.x;
          targetY = stealTarget.brazier.y;
        } else {
          stealTarget = null;
        }
        if (enemy.channel > 0 && (!stealTarget || stealTarget.brazier.id !== enemy.channelBrazierId)) {
          enemy.channel = 0;
          enemy.channelBrazierId = null;
        }
      }

      var dx = targetX - enemy.x;
      var dy = targetY - enemy.y;
      var distance = length(dx, dy);
      var dirX = distance > 0.001 ? dx / distance : 0;
      var dirY = distance > 0.001 ? dy / distance : 1;

      if (enemy.type === 'thief' && stealTarget) {
        if (distance <= 42) {
          stationary = true;
          if (enemy.channel <= 0) {
            enemy.channel = 0.0001;
            enemy.channelBrazierId = stealTarget.brazier.id;
            emit(state, 'thief-channel', {
              x: stealTarget.brazier.x,
              y: stealTarget.brazier.y,
              enemyId: enemy.id,
              name: stealTarget.brazier.name
            });
          } else {
            enemy.channel += dt;
            if (enemy.channel >= BALANCE.THIEF_STEAL_TIME) {
              stealTarget.brazier.suppressed = BALANCE.THIEF_SUPPRESS_TIME;
              stealTarget.brazier.stolenBy = enemy.id;
              enemy.stolen = true;
              enemy.stolenBrazierId = stealTarget.brazier.id;
              enemy.channel = 0;
              enemy.channelBrazierId = null;
              emit(state, 'brazier-stolen', {
                x: stealTarget.brazier.x,
                y: stealTarget.brazier.y,
                name: stealTarget.brazier.name,
                enemyId: enemy.id
              });
            }
          }
        } else if (enemy.channel > 0) {
          enemy.channel = 0;
          enemy.channelBrazierId = null;
        }
      }

      if (enemy.type === 'weaver') {
        if (enemy.fogWindup > 0) {
          enemy.fogWindup = Math.max(0, enemy.fogWindup - dt);
          stationary = true;
          if (enemy.fogWindup <= 0) {
            var fogX = clamp(enemy.fogTargetX, BALANCE.BOUNDS.left, BALANCE.BOUNDS.right);
            var fogY = clamp(enemy.fogTargetY, BALANCE.BOUNDS.top, BALANCE.BOUNDS.bottom);
            state.fogZones.push({
              id: state.nextFogId++,
              x: fogX,
              y: fogY,
              radius: BALANCE.FOG_RADIUS,
              hp: BALANCE.FOG_HP,
              maxHp: BALANCE.FOG_HP,
              ttl: BALANCE.FOG_TTL,
              age: 0
            });
            if (state.fogZones.length > BALANCE.MAX_FOG_ZONES) {
              state.fogZones.shift();
            }
            emit(state, 'fog-created', { x: fogX, y: fogY, radius: BALANCE.FOG_RADIUS });
          }
        } else {
          enemy.fogCooldown -= dt;
          if (enemy.fogCooldown <= 0 && playerDistance < 480) {
            enemy.fogWindup = BALANCE.FOG_WINDUP;
            enemy.fogCooldown = BALANCE.FOG_COOLDOWN;
            enemy.fogTargetX = player.x;
            enemy.fogTargetY = player.y;
            emit(state, 'fog-telegraph', {
              x: player.x,
              y: player.y,
              enemyId: enemy.id
            });
          }
        }

        if (!stationary) {
          var pd = Math.max(playerDistance, 0.001);
          if (playerDistance < 168) {
            dirX = -playerDx / pd;
            dirY = -playerDy / pd;
          } else if (playerDistance > 292) {
            dirX = playerDx / pd;
            dirY = playerDy / pd;
          } else {
            var strafe = Math.sin(enemy.age * 0.8 + enemy.phase) >= 0 ? 1 : -1;
            dirX = (-playerDy / pd) * strafe;
            dirY = (playerDx / pd) * strafe;
          }
          dirX += Math.sin(enemy.age * 1.3 + enemy.phase) * 0.08;
          dirY += Math.cos(enemy.age * 1.1 + enemy.phase) * 0.08;
          var wn = normalize(dirX, dirY);
          dirX = wn.x;
          dirY = wn.y;
        }
      } else if (enemy.type === 'wraith') {
        var sway = Math.sin(enemy.age * 2.1 + enemy.phase) * 0.22;
        var px = -dirY;
        var py = dirX;
        dirX += px * sway;
        dirY += py * sway;
        var dn = normalize(dirX, dirY);
        dirX = dn.x;
        dirY = dn.y;
      } else if (enemy.type === 'brute') {
        dirX += Math.sin(enemy.age * 0.9 + enemy.phase) * 0.08;
        dirY += Math.cos(enemy.age * 0.8 + enemy.phase) * 0.08;
        var db = normalize(dirX, dirY);
        dirX = db.x;
        dirY = db.y;
      }

      var slow = enemy.slowFactor;
      var moveSpeed = enemy.speed * (1 - slow);
      if (!stationary) {
        enemy.x += (dirX * moveSpeed + enemy.knockX) * dt;
        enemy.y += (dirY * moveSpeed + enemy.knockY) * dt;
      } else {
        enemy.x += enemy.knockX * dt;
        enemy.y += enemy.knockY * dt;
      }
      enemy.knockX *= Math.exp(-6.2 * dt);
      enemy.knockY *= Math.exp(-6.2 * dt);

      /* 光源判定 */
      var glowDistance = length(player.x - enemy.x, player.y - enemy.y);
      var baseDps = 0;
      var source = null;
      if (glowDistance <= BALANCE.BASE_LIGHT_RADIUS + enemy.radius * 0.35) {
        baseDps = BALANCE.BASE_LIGHT_DPS;
        source = 'glow';
      }

      var beamDps = 0;
      if (player.beamActive && glowDistance <= BALANCE.BEAM_RANGE + enemy.radius) {
        var vx = (enemy.x - player.x) / Math.max(glowDistance, 0.001);
        var vy = (enemy.y - player.y) / Math.max(glowDistance, 0.001);
        var dot = vx * player.aimX + vy * player.aimY;
        if (dot >= Math.cos(BALANCE.BEAM_HALF_ANGLE)) {
          beamDps = getBeamDps(state);
          source = 'beam';
        }
      }

      var brazierDps = 0;
      var auraRadius = getBrazierAuraRadius(state);
      var auraDps = getBrazierAuraDps(state);
      for (j = 0; j < state.braziers.length; j++) {
        var brazier = state.braziers[j];
        if (!brazier.lit || brazier.suppressed > 0) continue;
        var bd = length(enemy.x - brazier.x, enemy.y - brazier.y);
        if (bd <= auraRadius + enemy.radius * 0.25) {
          brazierDps = Math.max(brazierDps, auraDps);
          if (source !== 'beam') source = 'brazier';
        }
      }

      var finaleDps = 0;
      if (state.phase === 'finale') {
        var fd = length(enemy.x - state.lighthouse.x, enemy.y - state.lighthouse.y);
        if (fd <= state.lighthouse.auraRadius) {
          finaleDps = BALANCE.FINALE_AURA_DPS;
          if (!source || source === 'glow') source = 'lighthouse';
        }
      }

      /* 携灯影以窃取古灯为目标，不能被古灯/长灯的环境光环自动清除；
         玩家必须用自身灯火或直接火力打断它，保证追灯阶段由行动推进。 */
      if (enemy.type === 'thief' || (enemy.quest && enemy.type === 'weaver')) {
        brazierDps = 0;
        finaleDps = 0;
      }

      var dps = Math.max(baseDps, beamDps, brazierDps, finaleDps);
      var slowTarget = 0;
      if (beamDps > 0) slowTarget = Math.max(slowTarget, BALANCE.BEAM_SLOW);
      if (brazierDps > 0) slowTarget = Math.max(slowTarget, BALANCE.BRAZIER_AURA_SLOW);
      if (finaleDps > 0) slowTarget = Math.max(slowTarget, BALANCE.FINALE_AURA_SLOW);
      enemy.slowFactor += (slowTarget - enemy.slowFactor) * Math.min(1, dt * 8);

      if (dps > 0 && state.phase !== 'defeat' && state.phase !== 'victory') {
        damageEnemy(state, enemy, dps * dt, source);
      }

      if (!enemy.dead && player.invuln <= 0) {
        var contact = BALANCE.PLAYER_RADIUS + enemy.radius;
        if (length(player.x - enemy.x, player.y - enemy.y) < contact) {
          var wasHit = applyDamageToPlayer(state, enemy.damage, enemy.x, enemy.y);
          if (wasHit) {
            var kx = enemy.x - player.x;
            var ky = enemy.y - player.y;
            var kn = normalize(kx, ky);
            enemy.knockX += kn.x * BALANCE.ENEMY_KNOCKBACK * enemy.knockbackScale;
            enemy.knockY += kn.y * BALANCE.ENEMY_KNOCKBACK * enemy.knockbackScale;
            if (state.phase === 'defeat') break;
          }
        }
      }
    }

    /* 暗影之间保持间距 */
    var activeCount = state.enemies.length;
    for (i = 0; i < activeCount; i++) {
      var a = state.enemies[i];
      if (a.dead) continue;
      for (j = i + 1; j < activeCount; j++) {
        var b = state.enemies[j];
        if (b.dead) continue;
        var ddx = b.x - a.x;
        var ddy = b.y - a.y;
        var minDist = (a.radius + b.radius) * 0.92;
        var d = length(ddx, ddy);
        if (d > 0.001 && d < minDist) {
          var overlap = (minDist - d) * 0.5;
          var ux = ddx / d;
          var uy = ddy / d;
          a.x -= ux * overlap;
          a.y -= uy * overlap;
          b.x += ux * overlap;
          b.y += uy * overlap;
        }
      }
    }

    /* 清理与拾取 */
    for (i = state.enemies.length - 1; i >= 0; i--) {
      var e = state.enemies[i];
      if (e.dead || e.x < -360 || e.x > BALANCE.WORLD_W + 360 || e.y < -360 || e.y > BALANCE.WORLD_H + 360) {
        state.enemies.splice(i, 1);
      }
    }

    for (i = state.pickups.length - 1; i >= 0; i--) {
      var pickup = state.pickups[i];
      pickup.age += dt;
      if (pickup.age >= pickup.ttl) {
        state.pickups.splice(i, 1);
        continue;
      }
      if (length(player.x - pickup.x, player.y - pickup.y) < BALANCE.PICKUP_RADIUS) {
        player.oil = Math.min(player.maxOil, player.oil + pickup.amount);
        state.oilCollected += pickup.amount;
        state.stats.oilCollected += pickup.amount;
        state.pickups.splice(i, 1);
        emit(state, 'pickup-oil', {
          x: pickup.x,
          y: pickup.y,
          amount: pickup.amount
        });
      }
    }
  }

  /* ---------------- 古灯回复与终局 ---------------- */

  function updateAurasAndFinale(state, dt) {
    var player = state.player;
    var i;
    var inBrazierLight = false;
    var auraRadius = getBrazierAuraRadius(state);
    var auraRegen = getBrazierAuraRegen(state);
    for (i = 0; i < state.braziers.length; i++) {
      var brazier = state.braziers[i];
      if (!brazier.lit) continue;
      brazier.pulse = Math.max(0, brazier.pulse - dt * 1.4);
      brazier.flare = Math.max(0, brazier.flare - dt * 1.1);
      if (brazier.suppressed > 0) {
        brazier.suppressed = Math.max(0, brazier.suppressed - dt);
        if (brazier.suppressed === 0 && brazier.stolenBy !== null) {
          brazier.stolenBy = null;
          brazier.pulse = 1;
          emit(state, 'brazier-restored', {
            x: brazier.x,
            y: brazier.y,
            name: brazier.name,
            cause: 'timeout'
          });
        }
        continue;
      }
      if (length(player.x - brazier.x, player.y - brazier.y) <= auraRadius) {
        inBrazierLight = true;
      }
    }

    if (inBrazierLight) {
      player.oil = Math.min(player.maxOil, player.oil + auraRegen * dt);
    }

    if (state.phase !== 'finale') return;

    state.finaleTime += dt;
    state.stats.finaleSurvived = state.finaleTime;
    var progress = clamp(state.finaleTime / state.finaleDuration, 0, 1);
    state.lighthouse.auraRadius = lerp(
      BALANCE.FINALE_AURA_START,
      BALANCE.FINALE_AURA_END,
      progress
    );
    state.lighthouse.pulse = 0.5 + Math.sin(state.finaleTime * 3.2) * 0.22;

    if (length(player.x - state.lighthouse.x, player.y - state.lighthouse.y) <= state.lighthouse.auraRadius) {
      player.oil = Math.min(player.maxOil, player.oil + BALANCE.FINALE_AURA_REGEN * dt);
    }

    var remaining = Math.max(0, state.finaleDuration - state.finaleTime);
    if (remaining <= 5.05) {
      var tick = Math.ceil(remaining);
      if (tick !== state.finaleLastTick && tick > 0) {
        state.finaleLastTick = tick;
        emit(state, 'finale-tick', { remaining: tick });
      }
    }

    if (state.finaleTime >= state.finaleDuration) {
      state.phase = 'victory';
      var timeBonus = Math.max(0, Math.floor(state.timeLeft)) * 5;
      state.score += 500 + timeBonus;
      state.stats.finaleSurvived = state.finaleDuration;
      emit(state, 'victory', {
        score: state.score,
        elapsed: state.elapsed,
        timeBonus: timeBonus,
        timeLeft: state.timeLeft
      });
    }
  }

  /* ---------------- 主更新 ---------------- */

  function update(state, dt, rawInput) {
    if (!state || (state.phase !== 'playing' && state.phase !== 'finale')) return state;
    dt = Number(dt);
    if (!Number.isFinite(dt) || dt <= 0) return state;
    dt = Math.min(dt, 0.05);

    var input = rawInput || {};
    state.elapsed += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    if (state.phase === 'finale') {
      state.finaleTime += 0; /* 由 updateAurasAndFinale 推进，保持顺序清晰 */
    }

    updatePlayer(state, dt, input);
    if (state.phase === 'defeat' || state.phase === 'victory') return state;

    updateInteraction(state, dt, input);
    updateExpedition(state, dt);
    updateAurasAndFinale(state, dt);

    /* 终局状态下不再生成与结算新敌人 */
    if (state.phase === 'victory') return state;
    updateEnemies(state, dt);
    updateFogZones(state, dt);

    if (state.player.hp <= 0 && state.phase !== 'defeat') {
      state.phase = 'defeat';
      emit(state, 'defeat', { reason: 'health', elapsed: state.elapsed, score: state.score });
    }

    if (state.phase !== 'victory' && state.timeLeft <= 0 && state.phase !== 'defeat') {
      state.phase = 'defeat';
      emit(state, 'defeat', { reason: 'dawn', elapsed: state.elapsed, score: state.score });
    }

    return state;
  }

  function drainEvents(state) {
    if (!state || !state.events || state.events.length === 0) return [];
    var events = state.events;
    state.events = [];
    return events;
  }

  function getEnemyTypes() {
    return ENEMY_TYPES;
  }

  function getBraziers() {
    return BRAZIER_DEFS;
  }

  return {
    VERSION: VERSION,
    BALANCE: BALANCE,
    ENEMY_TYPES: ENEMY_TYPES,
    BRAZIER_DEFS: BRAZIER_DEFS,
    MAPS: MAPS,
    MODES: MODES,
    LIGHTHOUSE_TYPES: LIGHTHOUSE_TYPES,
    createGame: createGame,
    update: update,
    drainEvents: drainEvents,
    getObjective: getObjective,
    getNearestBrazier: getNearestBrazier,
    getInteractTarget: getInteractTarget,
    getLighthouseDistance: getLighthouseDistance,
    getLitCount: getLitCount,
    isInteractable: isInteractable,
    clamp: clamp,
    normalize: normalize,
    getEnemyTypes: getEnemyTypes,
    getBraziers: getBraziers,
    getMapConfig: getMapConfig,
    getModeConfig: getModeConfig,
    getLighthouseConfig: getLighthouseConfig,
    getBeamDps: getBeamDps,
    getBeamOilPerSec: getBeamOilPerSec,
    getBrazierAuraRadius: getBrazierAuraRadius,
    getBrazierAuraDps: getBrazierAuraDps,
    getBrazierAuraRegen: getBrazierAuraRegen,
    getIgniteTime: getIgniteTime,
    getObjectiveTargets: getObjectiveTargets,
    isInRiver: isInRiver,
    isOnBridge: isOnBridge,
    isInFog: isInFog,
    spawnEnemy: spawnEnemy
  };
});
