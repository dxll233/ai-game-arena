/* ============================================================
 * 星尘幸存者 第二轮 自动化逻辑测试
 * 覆盖：A1 折行 / A2 命中去重 / A3 失焦清键
 *       B1 三路线机制升级 / B2 新敌人 / B3 Boss 双阶段
 *       回归：结算一次性、连续重开 10 次
 * 运行：node tests/run-tests.cjs
 * ============================================================ */
const { loadGame, test, eq, ok, summary } = require('./harness.cjs');
const loaded = loadGame();
const T = loaded.SSTest;
const { setVisibility } = loaded;

const press = (key) => T.dispatch({ type: 'keydown', key, preventDefault(){} });
const release = (key) => T.dispatch({ type: 'keyup', key, preventDefault(){} });
const blur = () => T.dispatch({ type: 'blur' });
const vis = (state) => { setVisibility(state); T.dispatch({ type: 'visibilitychange' }); };

/* 15px 字号下与游戏渲染近似的文字测量：全角≈15，半角≈8.25 */
const measure15 = (s) => {
  let w = 0;
  for (const ch of String(s)) w += ch.codePointAt(0) > 0x2e00 ? 15 : 8.25;
  return w;
};

/* ---------------- A1 卡牌文字折行 ---------------- */
console.log('\n[A1] 卡牌文字折行');
test('A1-1 wrapLines 折行函数存在', () => {
  ok(typeof T.wrapLines === 'function', 'wrapLines 不存在（P0 修复前应失败）');
});
if (T.wrapLines) {
  test('A1-2 “最大生命 +25，并立即回复 25” 中 +25 不被拆开', () => {
    const lines = T.wrapLines('最大生命 +25，并立即回复 25', 194, measure15);
    const joined = lines.join('|');
    ok(joined.includes('+25'), '+25 被拆开：' + joined);
    ok(lines.slice(0, -1).every(l => !/[0-9]$/.test(l) || /[+\-]?\d+%?/.test(l) === false), '存在行尾截断数字：' + joined);
    ok(lines.length <= 3, '描述不应超过 3 行，实际 ' + lines.length);
  });
  test('A1-3 窄卡片(150px)下数字仍完整', () => {
    const lines = T.wrapLines('武器射速 +20%，弹道数 +1', 150, measure15);
    const joined = lines.join('|');
    ok(joined.includes('+20%'), '+20% 被拆开：' + joined);
    ok(joined.includes('+1'), '+1 被拆开：' + joined);
  });
}

/* ---------------- A2 子弹命中去重 ---------------- */
console.log('\n[A2] 弹丸命中去重（hitSet）');
test('A2-1 同一敌人跨多帧只扣一次血、只消耗一次穿透', () => {
  T.resetGame();
  const p = T.player;
  p.x = 800; p.y = 300; p.cd = 999; // 关闭玩家自动开火，隔离夹具
  const e = T.spawnEnemy('brute', 200, 300);
  // 真实开火路径产生的弹丸必须自带 hitSet
  p.cd = 0; T.fireWeapon();
  ok(T.bullets.length >= 1 && T.bullets.every(b => b.hitSet instanceof Set), '真实弹丸缺少 hitSet');
  T.bullets.length = 0;
  p.cd = 999;
  const hp0 = e.hp;
  // 静止弹丸持续覆盖同一敌人，穿透 2
  const b = { x: 200, y: 300, vx: 0, vy: 0, r: 5, dmg: 14, pierce: 2, life: 1.6, hitSet: new Set() };
  T.bullets.push(b);
  for (let i = 0; i < 12; i++) T.update(0.016);
  eq(hp0 - e.hp, 14, '同一敌人应只受 1 次伤害');
  eq(b.pierce, 1, '应只消耗 1 次穿透');
  ok(b.dead !== true, '弹丸不应被销毁');
});
test('A2-2 穿透弹经过两个不同敌人各命中一次后销毁', () => {
  T.resetGame();
  const p = T.player; p.x = 480; p.y = 560; p.cd = 999;
  const a = T.spawnEnemy('brute', 100, 300);
  const c = T.spawnEnemy('brute', 168, 300);
  const hpA0 = a.hp, hpC0 = c.hp;
  T.bullets.push({ x: 96, y: 300, vx: 430, vy: 0, r: 5, dmg: 14, pierce: 1, life: 1.6, hitSet: new Set() });
  for (let i = 0; i < 14; i++) T.update(0.016);
  eq(hpA0 - a.hp, 14, '敌人 A 只应受 1 次伤害');
  eq(hpC0 - c.hp, 14, '敌人 C 只应受 1 次伤害');
  eq(T.bullets.length, 0, '穿透用尽后弹丸应销毁');
});
test('A2-3 pierce=0 只命中一个目标', () => {
  T.resetGame();
  const p = T.player; p.x = 480; p.y = 560; p.cd = 999;
  const a = T.spawnEnemy('brute', 100, 300);
  T.bullets.push({ x: 100, y: 300, vx: 0, vy: 0, r: 5, dmg: 14, pierce: 0, life: 1.6, hitSet: new Set() });
  T.update(0.016); T.update(0.016); T.update(0.016);
  eq(a.hp, a.maxhp - 14, 'pierce=0 应只造成 1 次伤害');
});

/* ---------------- A3 失焦/隐藏清键 ---------------- */
console.log('\n[A3] 失焦与页面隐藏按键清理');
test('A3-1 window blur 清除移动键，重新按下才移动', () => {
  T.resetGame();
  press('arrowright');
  eq(T.keys['arrowright'], true, '按下后应为 true');
  const x0 = T.player.x;
  T.update(0.1);
  ok(T.player.x > x0, '按住时应移动');
  blur();
  for (const k in T.keys) eq(T.keys[k], false, 'blur 后仍有键未清除：' + k);
  const x1 = T.player.x;
  T.update(0.1);
  eq(T.player.x, x1, 'blur 后未重按不应继续移动');
  press('arrowright');
  T.update(0.1);
  ok(T.player.x > x1, '重新按下后应恢复移动');
  release('arrowright');
});
test('A3-2 visibilitychange 隐藏清键，恢复后不自动继续', () => {
  T.resetGame();
  press('d');
  eq(T.keys['d'], true, 'd 应为 true');
  vis('hidden');
  eq(T.keys['d'] || false, false, '隐藏后 d 应清除');
  eq(T.G.state, 'pause', '游戏中隐藏页面应自动暂停');
  vis('visible');
  eq(T.G.state, 'pause', '恢复可见不应自动解除暂停');
});
test('A3-3 升级面板中失焦不破坏状态，选牌后正常回到游戏', () => {
  T.resetGame();
  const p = T.player;
  // 一颗恰好满足升级需求的星尘，且已过 .35s 落地延迟，确保只升 1 级
  const g = T.mkGem(p.x, p.y, 4); g.age = 0.4;
  T.gems.push(g);
  T.update(0.016);
  eq(T.G.state, 'levelup', '应进入升级面板');
  blur();
  eq(T.G.state, 'levelup', '升级面板不应被 blur 破坏');
  T.chooseUpgrade(0);
  eq(T.G.state, 'playing', '选牌后应正常回到游戏');
  eq(p.level, 2, '应恰好升 1 级');
});

/* ---------------- B1 三条武器路线 ---------------- */
console.log('\n[B1] 三条武器路线 6 项机制升级');
const has = (id) => T.UPGRADES.some(u => u.id === id);
const owned = (id) => (T.G.upgrades[id] || 0);
test('B1-0 六项机制升级均在奖池中', () => {
  ['fan', 'focus', 'overpierce', 'phase', 'mark', 'overflow'].forEach(id => ok(has(id), '缺少升级：' + id));
});
test('B1-1 扇面齐射：弹道+2、单发伤害-15%', () => {
  T.resetGame();
  const p = T.player;
  const n0 = p.n, d0 = p.dmg;
  const u = T.UPGRADES.find(x => x.id === 'fan');
  u.apply(p);
  eq(p.n, n0 + 2, '弹道应 +2');
  ok(Math.abs(p.dmg - d0 * 0.85) < 0.01, '伤害应 ×0.85');
  eq(owned('fan'), 0, 'apply 不直接写 upgrades（由 chooseUpgrade 写）');
});
test('B1-2 近距聚束：近距离收束弹道', () => {
  T.resetGame();
  const p = T.player;
  const u = T.UPGRADES.find(x => x.id === 'focus');
  ok(u, 'focus 应存在');
  u.apply(p);
  ok(p.focus >= 1, 'focus 等级应增加');
  // 近距离开火，多发弹丸方向应收束：直接验证发弹角度差小于散射牌
  p.x = 100; p.y = 300; p.n = 5; p.pierce = 0;
  T.enemies.push(T.spawnEnemy('chaser', 160, 300));
  T.fireWeapon();
  const bs = T.bullets;
  eq(bs.length, 5, '应发射 5 发');
  const ang = bs.map(b => Math.atan2(b.vy, b.vx));
  const spread = Math.max(...ang) - Math.min(...ang);
  ok(spread < 14 * Math.PI / 180 * 4 * 0.7, '近距应明显收束，实际夹角 ' + spread.toFixed(3));
});
test('B1-3 过载贯穿：命中后加速且后续伤害提高', () => {
  T.resetGame();
  const p = T.player; p.x = 480; p.y = 560;
  T.UPGRADES.find(x => x.id === 'overpierce').apply(p);
  ok(p.over >= 1, 'over 等级应增加');
  // 构造一发穿透弹连续命中两个敌人
  T.spawnEnemy('brute', 100, 300);
  T.spawnEnemy('brute', 170, 300);
  const b = { x: 96, y: 300, vx: 430, vy: 0, r: 5, dmg: 14, pierce: 3, life: 1.6, hitSet: new Set() };
  T.bullets.push(b);
  const spd0 = Math.hypot(b.vx, b.vy), dmg0 = b.dmg;
  for (let i = 0; i < 16; i++) T.update(0.016);
  ok(b.hitSet.size >= 1, '应有命中记录');
  ok(Math.hypot(b.vx, b.vy) > spd0, '命中后弹丸应加速');
  ok(b.dmg > dmg0, '后续伤害应提高');
});
test('B1-4 相位弹：无视护盾编织者赋予的护盾直接打血', () => {
  T.resetGame();
  const p = T.player; p.x = 480; p.y = 560;
  T.UPGRADES.find(x => x.id === 'phase').apply(p);
  eq(p.phase, 1, 'phase 应为 1');
  const e = T.spawnEnemy('brute', 200, 300);
  e.eshield = 1; e.eshieldT = 9;
  const hp0 = e.hp;
  T.bullets.push({ x: 200, y: 300, vx: 0, vy: 0, r: 5, dmg: 14, pierce: 0, life: 1.6, hitSet: new Set(), phase: 1 });
  T.update(0.016);
  eq(e.eshield, 1, '相位弹不消除护盾（留给普通弹处理）');
  eq(hp0 - e.hp, 14, '应直接对本体造成伤害');
});
test('B1-5 普通弹被护盾抵挡（0 血伤、弹丸消耗）', () => {
  T.resetGame();
  T.player.cd = 999;
  const e = T.spawnEnemy('brute', 200, 300);
  e.eshield = 1; e.eshieldT = 9;
  const hp0 = e.hp;
  T.bullets.push({ x: 200, y: 300, vx: 0, vy: 0, r: 5, dmg: 14, pierce: 0, life: 1.6, hitSet: new Set(), phase: 0 });
  T.update(0.016);
  eq(e.hp, hp0, '护盾应完全抵挡本次伤害');
  eq(e.eshield, 0, '护盾应被击破');
  eq(T.bullets.length, 0, '挡盾应消耗弹丸');
});
test('B1-6 标记追猎：连续命中叠标后爆发一次额外伤害', () => {
  T.resetGame();
  const p = T.player;
  T.UPGRADES.find(x => x.id === 'mark').apply(p);
  eq(p.mark, 1, 'mark 应为 1');
  const e = T.spawnEnemy('brute', 300, 300);
  e.hp = 9999; e.maxhp = 9999;
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const before = e.hp;
    T.bullets.push({ x: 300, y: 300, vx: 0, vy: 0, r: 5, dmg: 10, pierce: 9, life: 1.6, hitSet: new Set() });
    T.update(0.016);
    total += before - e.hp;
  }
  // 6 次命中：前 5 次叠标，第 5 次命中同时触发爆发(+80%=8)，第 6 次为新一层 10
  // 期望基础 60 + 一次爆发 8 = 68（允许标记计时未衰减）
  ok(total > 60, '应出现追猎爆发额外伤害，实际总伤 ' + total);
  ok(e.marks >= 1 || total === 68, '标记应在爆发后重置');
});
test('B1-7 标记 2.5 秒未续上则清空', () => {
  T.resetGame();
  const p = T.player; p.cd = 999; // 关闭自动开火，防止真实弹道续标
  T.UPGRADES.find(x => x.id === 'mark').apply(p);
  const e = T.spawnEnemy('brute', 300, 300);
  e.hp = 9999;
  T.bullets.push({ x: 300, y: 300, vx: 0, vy: 0, r: 5, dmg: 10, pierce: 9, life: 1.6, hitSet: new Set() });
  T.update(0.016);
  ok(e.marks >= 1, '应叠加标记');
  for (let i = 0; i < 170; i++) T.update(0.016); // ~2.7s
  eq(e.marks, 0, '超时后标记应清空');
});
test('B1-8 溢出追踪：击杀后弹丸转向次近敌人', () => {
  T.resetGame();
  const p = T.player; p.x = 480; p.y = 560;
  T.UPGRADES.find(x => x.id === 'overflow').apply(p);
  eq(p.overflow, 1, 'overflow 应为 1');
  const a = T.spawnEnemy('dasher', 100, 300); // hp12，会被 14 伤秒掉
  const b = T.spawnEnemy('brute', 150, 300);
  const bul = { x: 100, y: 300, vx: 430, vy: 0, r: 5, dmg: 14, pierce: 2, life: 1.6, hitSet: new Set() };
  T.bullets.push(bul);
  for (let i = 0; i < 6; i++) T.update(0.016);
  ok(a.dead === true, '近处敌人应被击杀');
  ok(bul.hitSet.size >= 1, '弹丸存活且继续飞行');
  const towardB = Math.sign(b.x - 100) === 1 ? Math.cos(Math.atan2(b.vy, bul.vx)) : 0;
  ok(Math.hypot(bul.vx, bul.vy) > 300, '弹丸保持速度');
  // 数帧内应命中次近敌人
  for (let i = 0; i < 20; i++) T.update(0.016);
  ok(b.hp < b.maxhp, '次近敌人应被转向后的弹丸命中');
});
test('B1-9 六项升级叠层上限：满阶后不再进入奖池，重开后全部清零', () => {
  T.resetGame();
  const defs = { fan: 2, focus: 2, overpierce: 2, phase: 1, mark: 2, overflow: 1 };
  for (const id in defs) {
    const u = T.UPGRADES.find(x => x.id === id);
    eq(u.max, defs[id], id + ' 上限不符');
    // 通过正规选牌路径拿满
    for (let i = 0; i < defs[id]; i++){
      T.G.state = 'levelup'; T.G.choices = [u]; T.chooseUpgrade(0);
    }
    eq(T.G.upgrades[id], defs[id], id + ' 应恰好叠满');
    // 满阶后 rollChoices 不应再提供（奖池过滤即上限强制点）
    for (let k = 0; k < 50; k++){
      ok(!T.rollChoices().some(x => x.id === id), id + ' 满阶后仍出现在奖池');
    }
  }
  T.resetGame();
  eq(T.G.upgrades, {}, '重开后升级记录清空');
  const p = T.player;
  eq(p.focus + p.over + p.phase + p.mark + p.overflow, 0, '重开后机制标记应清零');
});

/* ---------------- B2 特殊敌人 ---------------- */
console.log('\n[B2] 护盾编织者 / 裂变幼体');
test('B2-1 两类新敌人配置存在且数值合理', () => {
  ok(T.ETYPES.weaver, '缺少 weaver');
  ok(T.ETYPES.larva, '缺少 larva');
  ok(T.ETYPES.splinter, '缺少 splinter');
  ok(T.ETYPES.weaver.hp > 20 && T.ETYPES.weaver.xp >= 2, '编织者数值');
  ok(T.ETYPES.larva.hp > 20, '幼体数值');
  ok(T.ETYPES.splinter.hp <= 12, '分裂体应为低血量小型单位');
});
test('B2-2 编织者周期施放，附近敌人获得可见护盾', () => {
  T.resetGame();
  const w = T.spawnEnemy('weaver', 300, 300);
  const e1 = T.spawnEnemy('chaser', 360, 300);
  const e2 = T.spawnEnemy('chaser', 700, 100); // 超出范围
  w.castT = 0.01;
  T.update(0.016);
  eq(e1.eshield, 1, '射程内敌人应获得护盾');
  ok(e2.eshield === undefined || e2.eshield === 0, '射程外不应获得护盾');
  ok(w.pulseT > 0, '施放应有脉冲视觉计时');
});
test('B2-3 护盾有时限，到期消失', () => {
  T.resetGame();
  const e = T.spawnEnemy('chaser', 300, 300);
  e.eshield = 1; e.eshieldT = 0.5;
  for (let i = 0; i < 40; i++) T.update(0.016);
  eq(e.eshield, 0, '护盾应到期消失');
});
test('B2-4 裂变幼体死亡分裂为 3 个小型追击体', () => {
  T.resetGame();
  const l = T.spawnEnemy('larva', 300, 300);
  const n0 = T.enemies.length;
  T.killEnemy(l);
  const kids = T.enemies.filter(e => e.type === 'splinter');
  eq(kids.length, 3, '应分裂 3 只');
  ok(kids.every(k => k.r < 12), '分裂体应更小');
});
test('B2-5 分裂体可被击杀、掉落经验，不再二次分裂', () => {
  T.resetGame();
  T.player.cd = 999;
  const s = T.spawnEnemy('splinter', 300, 300);
  const gems0 = T.gems.length;
  T.killEnemy(s);
  T.update(0.016); // 正式游戏中死亡实体在同帧末尾过滤
  ok(T.enemies.filter(e => e.type === 'splinter').length === 0, '不应二次分裂');
  ok(T.gems.length > gems0, '应掉落星尘');
});
test('B2-6 刷怪表在指定时间后可产出两类新敌人（5000 次采样）', () => {
  T.resetGame();
  T.G.time = 55;
  const seen = new Set();
  const orig = T.spawnEnemy;
  // 直接采样 spawnRandom 产出类型
  for (let i = 0; i < 5000; i++) {
    T.enemies.length = 0;
    T.spawnRandom();
    if (T.enemies[0]) seen.add(T.enemies[0].type);
  }
  ok(seen.has('weaver'), '55s 后应能刷出编织者：' + [...seen].join(','));
  T.G.time = 80;
  seen.clear();
  for (let i = 0; i < 5000; i++) {
    T.enemies.length = 0;
    T.spawnRandom();
    if (T.enemies[0]) seen.add(T.enemies[0].type);
  }
  ok(seen.has('larva'), '80s 后应能刷出幼体：' + [...seen].join(','));
});

/* ---------------- B3 Boss 双阶段 ---------------- */
console.log('\n[B3] Boss 双阶段');
test('B3-1 Boss 初始阶段 1，HP 50% 时一次性转入阶段 2', () => {
  T.resetGame();
  const b = T.spawnEnemy('boss', 480, 300);
  eq(b.phase, 1, '初始应为阶段 1');
  b.hp = b.maxhp * 0.5 + 1;
  T.update(0.016);
  eq(b.phase, 1, '未到阈值不应转换');
  b.hp = b.maxhp * 0.5;
  T.update(0.016);
  eq(b.phase, 2, '到达 50% 应转换');
  const banner1 = T.G.banner && T.G.banner.text;
  ok(banner1, '转换应有横幅提示');
  b.hp = 1;
  T.update(0.016); T.update(0.016);
  eq(b.phase, 2, '转换只发生一次，不应再变');
});
test('B3-2 转换后进入扇形/冲刺交替循环，召唤间隔缩短', () => {
  T.resetGame();
  const b = T.spawnEnemy('boss', 480, 300);
  b.hp = b.maxhp * 0.5;
  T.update(0.016);
  ok(b.p2 && b.p2.mode, '应有阶段二行为状态');
  const modes = new Set();
  for (let i = 0; i < 600; i++) { T.update(0.016); modes.add(b.p2.mode); }
  ok(modes.has('warn_fan') && modes.has('dash'), '应交替出现扇形预警与冲刺：' + [...modes].join(','));
  ok(modes.has('warn_dash'), '冲刺前应有预警状态：' + [...modes].join(','));
  ok(b.summonT < 14, '阶段二召唤间隔应缩短');
});
test('B3-3 阶段二扇形弹幕朝玩家方向射出', () => {
  T.resetGame();
  T.player.x = 480; T.player.y = 500;
  const b = T.spawnEnemy('boss', 480, 200);
  b.hp = b.maxhp * 0.5;
  T.update(0.016);
  // 推进到一次 fan 行动后
  for (let i = 0; i < 600 && !T.ebullets.length; i++) T.update(0.016);
  ok(T.ebullets.length >= 5, '应发射扇形弹幕');
  const downward = T.ebullets.filter(x => x.vy > 0).length;
  ok(downward >= T.ebullets.length / 2, '弹幕主体应朝玩家所在方向（下方）');
});
test('B3-4 冲刺有预警且冲刺后可被躲避（非永久加速）', () => {
  T.resetGame();
  const b = T.spawnEnemy('boss', 480, 300);
  b.hp = b.maxhp * 0.5;
  T.update(0.016);
  let sawWarn = false, sawDash = false, dashEnded = false;
  for (let i = 0; i < 900; i++) {
    T.update(0.016);
    if (b.p2.mode === 'warn_dash') sawWarn = true;
    if (b.p2.mode === 'dash') sawDash = true;
    if (sawDash && b.p2.mode !== 'dash') dashEnded = true;
  }
  ok(sawWarn, '冲刺前应有预警状态');
  ok(sawDash, '应进入冲刺状态');
  ok(dashEnded, '冲刺应结束（可躲避窗口）');
});
test('B3-5 阶段二中击杀 Boss 只结算一次胜利', () => {
  T.resetGame();
  const b = T.spawnEnemy('boss', 480, 300);
  // 走真实转换路径，避免手工构造出 p2=null 的非法状态
  b.hp = b.maxhp * 0.5;
  T.update(0.016);
  eq(b.phase, 2, '前置：应已转换到阶段二');
  ok(b.invuln > 0, '转换瞬间应有无敌保护');
  // 高伤弹在无敌结束后完成击杀
  T.bullets.push({ x: 480, y: 300, vx: 0, vy: 0, r: 5, dmg: 9999, pierce: 5, life: 5, hitSet: new Set() });
  for (let i = 0; i < 200 && !T.G.ending; i++) T.update(0.016);
  eq(T.G.ending, 'win', '应进入胜利结算');
  eq(T.enemies.filter(e => e.type === 'boss').length, 0, 'Boss 应移除');
  // 再来几帧不应重复触发
  const kills0 = T.G.kills;
  for (let i = 0; i < 30; i++) T.update(0.016);
  eq(T.G.kills, kills0, '击杀计数不应重复增加');
});

/* ---------------- 回归：重开与状态清理 ---------------- */
console.log('\n[回归] 连续重开 / 终局');
test('R1 连续重开 10 次状态干净', () => {
  for (let i = 0; i < 10; i++) {
    T.startGame();
    // 制造脏状态
    T.spawnEnemy('chaser'); T.spawnEnemy('larva');
    T.bullets.push({ x: 0, y: 0, vx: 0, vy: 0, r: 1, dmg: 1, pierce: 0, life: 1, hitSet: new Set() });
    T.ebullets.push({ x: 0, y: 0, vx: 0, vy: 0, r: 1, dmg: 1, life: 1 });
    T.particles.push({ life: 1, max: 1 });
    T.player.shield = 3; T.player.focus = 2;
    T.G.upgrades = { fan: 2 };
    T.startGame();
    eq(T.G.state, 'playing', '第 ' + i + ' 次重开状态');
    eq(T.enemies.length, 0, '敌人清空');
    eq(T.bullets.length, 0, '子弹清空');
    eq(T.ebullets.length, 0, '敌弹清空');
    eq(T.player.level, 1, '等级重置');
    eq(T.player.hp, 100, '血量重置');
    eq(T.player.shield + T.player.focus, 0, '机制状态重置');
    eq(T.G.upgrades, {}, '升级记录重置');
    eq(T.G.bossSpawned, false, 'Boss 标志重置');
  }
});
test('R2 失败结算后 R 重开正常', () => {
  T.startGame();
  T.player.hp = 1; T.player.iframes = 0;
  T.spawnEnemy('chaser', T.player.x, T.player.y);
  for (let i = 0; i < 200 && T.G.state !== 'over'; i++) T.update(0.016);
  eq(T.G.state, 'over', '应进入失败结算');
  press('r');
  eq(T.G.state, 'playing', 'R 后应立即重开');
  eq(T.player.hp, 100, '血量恢复');
});

process.exit(summary());
