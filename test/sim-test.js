'use strict';
// 無頭模擬：每張地圖 × 每種模式放 6 隻電腦打一場，確認不會出錯、真的會交戰，而且各模式的目標真的有在進行
// 另外測：等待室流程、房主權限、坦克種類、自走砲拋射、空襲、空投與補給包
const { Room, MODES, createClient } = require('../shared/game');
const { MAPS } = require('../shared/maps');
const Core = require('../shared/core');
const { C, K, TILE, CLASSES } = Core;

let failed = false;
const fail = (msg) => { console.error('✗ ' + msg); failed = true; };
const pass = (msg) => console.log('✓ ' + msg);
const tickFor = (room, sec) => { for (let i = 0; i < sec * 60; i++) room.tick(); };

// ---- 回歸測試：三連發的三顆砲彈不能一出膛就互相抵銷
{
  const room = new Room('T3');
  room.settings.map = 0; room.startMatch();
  const p = room.addPlayer({ name: 'a', color: '#ff4d4d' });
  for (let i = 0; i < 10; i++) room.tick();
  // 十字戰場第 1 列往右是一整排空地
  Object.assign(p, { x: 2.5 * 40, y: 1.5 * 40, tripleT: 5, fireCd: 0, ta: 0, protectT: 0 });
  room.fire(p);
  room.updateBullets(C.DT);
  room.updateBullets(C.DT);
  if (room.bullets.length !== 3) fail(`三連發應該有 3 顆砲彈，實際 ${room.bullets.length}`);
  else pass('三連發 3 顆砲彈都飛出去了');
}

// ---- 數值：雷射 50、火焰射程和傷害提高
if (C.RAIL_DMG !== 50) fail(`雷射傷害應該是 50，現在是 ${C.RAIL_DMG}`);
else if (!(C.FLAME_RANGE > 155 && C.FLAME_DPS > 80)) fail('火焰噴射的射程 / 傷害沒有提高');
else pass(`雷射傷害 ${C.RAIL_DMG}、火焰射程 ${C.FLAME_RANGE}、火焰每秒傷害 ${C.FLAME_DPS}`);

// ---- 連線協定 + 等待室：房主開房（選模式、人數）→ 等人 → 到齊倒數 → 開打
{
  const room = new Room('NET');
  const mk = () => {
    const got = [];
    const sock = { readyState: 1, bufferedAmount: 0, send: (s) => got.push(JSON.parse(s)) };
    return { got, cl: createClient(sock, () => room, null, () => true), last: (t) => got.filter((m) => m.t === t).pop() };
  };
  const A = mk(), B = mk();
  A.cl.message(JSON.stringify({ t: 'join', name: '房主', color: '#ff4d4d', skin: 'gold', cls: 'heavy', room: 'NET', create: { mode: 'ctf', players: 2, bots: 2, level: 'hard', map: 6, target: 5 } }));
  tickFor(room, 0.5);
  const wA = A.last('welcome'), iA = A.last('info');
  const errs = [];
  if (!wA || !wA.host) errs.push('開房的人應該是房主');
  if (room.state !== 'waiting') errs.push(`人還沒到齊應該在等待室，現在是 ${room.state}`);
  if (!iA || !iA.wait || iA.wait.need !== 2 || iA.wait.have !== 1) errs.push('info 裡的等待資訊不對');
  if (room.settings.mode !== 'ctf' || room.settings.target !== 5 || room.settings.map !== 6 || room.allyBots().length !== 2) errs.push('開房設定沒有套用');
  if (iA && iA.players.find((p) => p.id === wA.id).c !== 'heavy') errs.push('坦克種類沒有傳出去');
  tickFor(room, 3);
  if (room.state !== 'waiting') errs.push('只有房主一個人不應該開始');
  B.cl.message({ t: 'join', name: '朋友', color: '#4da6ff', cls: 'light', room: 'NET', join: true });
  B.cl.message({ t: 'cmd', c: 'mode', v: 'ffa' }); // 不是房主，應該被拒絕
  tickFor(room, 1);
  if (room.settings.mode !== 'ctf') errs.push('不是房主也能換模式');
  if (!B.got.some((m) => m.t === 's' && m.E.some((e) => e.e === 'sys' && /只有房主/.test(e.t)))) errs.push('不是房主改設定應該收到提示');
  if (room.waitT === null && room.state === 'waiting') errs.push('人到齊了應該開始倒數');
  tickFor(room, 3.5);
  if (room.state !== 'playing') errs.push(`倒數完應該開打，現在是 ${room.state}`);
  const snapsB = B.got.filter((m) => m.t === 's');
  if (!snapsB.some((s) => s.O && s.O.f)) errs.push('搶旗快照裡沒有旗子狀態');
  // 房主回等待室 → 換模式 → 立刻開始
  for (const mode of Object.keys(MODES)) {
    A.cl.message({ t: 'cmd', c: 'lobby' });
    tickFor(room, 0.2);
    if (room.state !== 'waiting') { errs.push('房主回等待室失敗'); break; }
    A.cl.message({ t: 'cmd', c: 'mode', v: mode });
    A.cl.message({ t: 'cmd', c: 'start' });
    tickFor(room, 3.5);
    if (room.state !== 'playing' || room.settings.mode !== mode) { errs.push(`換成 ${mode} 開始失敗`); break; }
    tickFor(room, 1.5);
  }
  const snapsA = A.got.filter((m) => m.t === 's');
  if (!snapsA.some((s) => s.O && s.O.z) || !snapsA.some((s) => s.O && s.O.w !== undefined)) errs.push('快照裡缺少大逃殺 / 闖關的狀態');
  // 換坦克種類：活著的時候下次重生才生效
  const pB = room.players.get(B.last('welcome').id);
  if (pB.cls !== 'light' || pB.maxHp !== CLASSES.light.hp) errs.push('朋友的輕坦數值不對');
  B.cl.message({ t: 'cmd', c: 'cls', v: 'td' });
  tickFor(room, 0.1);
  if (pB.alive && (pB.cls !== 'light' || pB.nextCls !== 'td')) errs.push('活著換種類應該等下次重生');
  room.kill(pB, null, 'shell', {});
  tickFor(room, C.RESPAWN + 0.5);
  if (room.settings.mode === 'waves' && pB.out) { pB.out = false; pB.respawnT = 0; tickFor(room, 0.2); }
  if (pB.alive && (pB.cls !== 'td' || pB.maxHp !== CLASSES.td.hp || pB.r !== CLASSES.td.r)) errs.push(`重生後應該變成驅逐戰車（現在 ${pB.cls}）`);
  // 房主離開 → 房主交給下一個真人
  A.cl.close();
  if (room.hostId !== pB.id) errs.push('房主走了應該交給朋友');
  // 加入不存在的房間
  const C1 = (() => { const got = []; return { got, cl: createClient({ readyState: 1, bufferedAmount: 0, send: (s) => got.push(JSON.parse(s)) }, () => room, null, () => false) }; })();
  C1.cl.message({ t: 'join', name: 'x', room: 'NOPE', join: true });
  if (!C1.got.some((m) => m.t === 'noroom')) errs.push('加入不存在的房間應該回 noroom');
  // 開新房間但代碼已經有房主了 → 回 taken（換個代碼再開，不能跑進別人的房間）；同一條連線換代碼可以再開
  const rooms = new Map([['NET', room]]);
  const getR = (c) => { if (!rooms.has(c)) rooms.set(c, new Room(c)); return rooms.get(c); };
  const D1 = (() => { const got = []; return { got, cl: createClient({ readyState: 1, bufferedAmount: 0, send: (s) => got.push(JSON.parse(s)) }, getR, null, (c) => rooms.has(c)) }; })();
  const before = room.players.size;
  D1.cl.message({ t: 'join', name: '撞號', room: 'NET', create: { mode: 'ffa', players: 2 } });
  if (!D1.got.some((m) => m.t === 'taken') || room.players.size !== before) errs.push('開房撞到別人的代碼應該回 taken');
  D1.cl.message({ t: 'join', name: '撞號', room: 'NEW1', create: { mode: 'koth', players: 3 } });
  const wD = D1.got.find((m) => m.t === 'welcome');
  if (!wD || !wD.host || wD.room !== 'NEW1' || rooms.get('NEW1').settings.mode !== 'koth') errs.push('換代碼之後應該開成新房間');
  // 自己玩（人數 1）：直接開打
  const solo = new Room('SOLO');
  createClient({ readyState: 1, bufferedAmount: 0, send() {} }, () => solo).message({ t: 'join', name: 'me', room: 'SOLO', create: { mode: 'waves', players: 1, bots: 1 } });
  if (solo.state !== 'playing' || solo.settings.mode !== 'waves' || solo.allyBots().length !== 1) errs.push('單人模式應該直接開打');
  if (errs.length) fail('等待室 / 連線協定：' + errs.join('；'));
  else pass(`等待室流程、房主權限、換種類、加入不存在的房間、單人直接開打都正常（房主收到 ${A.got.length} 個訊息）`);
}

// ---- 自走砲：砲彈越過牆壁打到牆後面的人
{
  const room = new Room('ART');
  room.settings.map = 2; room.startMatch(); // 鋼鐵迷宮
  const a = room.addPlayer({ name: 'spg', color: '#ff4d4d', cls: 'spg' });
  const b = room.addPlayer({ name: 'tgt', color: '#4da6ff' });
  const m = room.map;
  let pair = null;
  for (let i = 0; i < m.tiles.length && !pair; i++) {
    if (m.tiles[i] !== Core.T.FLOOR) continue;
    const x0 = (i % m.w) * TILE + 20, y0 = Math.floor(i / m.w) * TILE + 20;
    for (let j = 0; j < m.tiles.length; j++) {
      if (m.tiles[j] !== Core.T.FLOOR) continue;
      const x1 = (j % m.w) * TILE + 20, y1 = Math.floor(j / m.w) * TILE + 20;
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d > 260 && d < 420 && !Core.lineClear(m, x0, y0, x1, y1)) { pair = [x0, y0, x1, y1, d]; break; }
    }
  }
  const [x0, y0, x1, y1, d] = pair;
  Object.assign(a, { x: x0, y: y0, vx: 0, vy: 0, ta: Math.atan2(y1 - y0, x1 - x0), tdist: d, fireCd: 0, ammo: 2, protectT: 0 });
  Object.assign(b, { x: x1, y: y1, vx: 0, vy: 0, protectT: 0, hp: b.maxHp });
  room.fire(a);
  const shells = room.shells.length, T = room.shells[0] && room.shells[0].T;
  for (let i = 0; i < 90 && room.shells.length; i++) { b.x = x1; b.y = y1; room.tick(); }
  if (shells !== 1) fail(`自走砲開砲應該有 1 顆拋射砲彈，實際 ${shells}`);
  else if (!(b.hp < b.maxHp - 30)) fail(`牆後面的目標應該被炸到（剩 ${b.hp.toFixed(0)} 血）`);
  else pass(`自走砲隔牆砲擊：飛行 ${T.toFixed(2)} 秒，牆後目標剩 ${Math.ceil(b.hp)} / ${b.maxHp} 血`);
}

// ---- 空襲：炸彈落在敵人附近，呼叫的人炸不到
{
  const room = new Room('AIR');
  room.settings.map = 0; room.startMatch();
  const caller = room.addPlayer({ name: 'caller', color: '#ff4d4d' });
  const foes = [0, 1, 2].map((i) => room.addPlayer({ name: 'foe' + i, color: '#4da6ff' }));
  const spots = [[6.5, 1.5], [9.5, 8.5], [24.5, 10.5], [16, 17.5]];
  [caller, ...foes].forEach((p, i) => Object.assign(p, { x: spots[i][0] * TILE, y: spots[i][1] * TILE, vx: 0, vy: 0, protectT: 0, shield: 0, hp: p.maxHp }));
  // 呼叫的人站在第一個敵人附近，炸彈落在他身邊也不能扣他的血（被炸爆的坦克噴到不算）
  Object.assign(caller, { x: foes[0].x + 60, y: foes[0].y });
  caller.air = 1;
  caller.held = K.CALL;
  let booms = 0, bombs = 0, selfAir = 0;
  const ev = room.event.bind(room);
  room.event = (e) => { if (e.e === 'boom' && e.k === 'air') booms++; ev(e); };
  const dmg = room.damage.bind(room);
  room.damage = (v, d, by, w, x) => { if (v === caller && w === 'air') selfAir++; return dmg(v, d, by, w, x); };
  room.updatePlayer(caller, C.DT);
  bombs = room.shells.length;
  caller.held = 0;
  for (let i = 0; i < 6 * 60; i++) { for (const p of room.players.values()) if (p.alive) { p.vx = p.vy = 0; } room.tick(); }
  const hurt = foes.filter((f) => !f.alive || f.hp < f.maxHp).length;
  if (bombs !== C.AIR_BOMBS || booms !== C.AIR_BOMBS) fail(`空襲應該有 ${C.AIR_BOMBS} 顆炸彈，排了 ${bombs} 顆、爆了 ${booms} 顆`);
  else if (caller.air !== 0) fail('空襲次數沒有扣掉');
  else if (selfAir) fail('呼叫空襲的人被自己的炸彈炸到了');
  else if (hurt < 2) fail(`空襲只炸到 ${hurt} 個敵人`);
  else pass(`空襲 ${booms} 顆炸彈，炸到 ${hurt}/3 個敵人，呼叫的人毫髮無傷`);
}

// ---- 每張地圖 × 每種模式
const SECONDS = 150;
const total = { drop: 0, crate: 0, supply: 0, air: 0, arty: 0 };
for (let mi = 0; mi < MAPS.length; mi++) {
  for (const mode of Object.keys(MODES)) {
    const room = new Room('TEST');
    room.settings.map = mi;
    room.settings.mode = mode;
    room.settings.target = mode === 'waves' ? 0 : 999;
    room.settings.time = SECONDS + 30;
    ['easy', 'normal', 'hard', 'normal', 'hard', 'easy'].forEach((l) => room.addBot(l));
    room.assignTeams(true);
    room.startMatch();
    const stats = { shot: 0, kill: 0, mine: 0, pu: 0, boom: 0, bnc: 0, rail: 0, dash: 0, self: 0, clash: 0, port: 0, pad: 0, brWin: 0, waveClear: 0, special: 0, drop: 0, crate: 0, supply: 0, aircall: 0, arty: 0 };
    const ev = room.event.bind(room);
    room.event = (e) => {
      if (e.e in stats) stats[e.e]++;
      if (e.e === 'kill' && e.self) stats.self++;
      if (e.e === 'flag') stats['f_' + e.a] = (stats['f_' + e.a] || 0) + 1;
      if (e.e === 'round' && e.w) stats.brWin++;
      if (e.e === 'wave' && e.a === 'clear') stats.waveClear++;
      if (e.e === 'shot' && (e.k === 2 || e.k === 3)) stats.special++;
      if (e.e === 'shot' && e.k === 4) stats.arty++;
      if (e.e === 'pu' && e.k === 'crate') stats.crate++;
      if (e.e === 'puspawn' && e.k === 'supply') stats.supply++;
      ev(e);
    };
    let maxHill = 0;
    const t0 = Date.now();
    try {
      for (let i = 0; i < SECONDS * 60; i++) {
        room.tick();
        for (const p of room.players.values()) {
          if (p.alive && (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.hp))) throw new Error(`NaN for ${p.name}`);
          if (p.alive && (p.x < 0 || p.y < 0 || p.x > room.map.w * 40 || p.y > room.map.h * 40)) throw new Error(`${p.name} 跑出地圖`);
          if (mode === 'koth') maxHill = Math.max(maxHill, p.score);
        }
        if (room.state !== 'playing') {
          if (mode !== 'waves') throw new Error('比賽不該提早結束');
          break; // 闖關模式電腦把生命用完就結束了，這是正常的
        }
        if (i % 600 === 0) JSON.stringify(room.infoMsg());
      }
    } catch (e) {
      fail(`${MAPS[mi].name} [${mode}] ${e.stack}`);
      continue;
    }
    const ms = Date.now() - t0;
    const checks = [stats.shot > 50, stats.kill > 5, stats.supply > 0];
    if (mode !== 'waves' || room.state === 'playing') checks.push(stats.drop > 0);
    let extra = '';
    if (mode === 'ctf') { checks.push(stats.f_take > 0); extra = `搶旗 ${stats.f_take || 0} 次、得分 ${stats.f_cap || 0} 次、奪回 ${stats.f_ret || 0} 次`; }
    if (mode === 'koth') { checks.push(maxHill > 5); extra = `最高佔山 ${maxHill.toFixed(0)} 秒`; }
    if (mode === 'br') { checks.push(stats.brWin >= 2); extra = `打完 ${room.obj.round} 回合（${stats.brWin} 回合有贏家）`; }
    if (mode === 'waves') { checks.push(room.obj.wave >= 2); extra = `打到第 ${room.obj.wave} 波${room.state !== 'playing' ? '（生命用完）' : ''}`; }
    const ok = checks.every(Boolean);
    if (!ok) failed = true;
    total.drop += stats.drop; total.crate += stats.crate; total.supply += stats.supply; total.air += stats.aircall; total.arty += stats.arty;
    console.log(`${ok ? '✓' : '✗'} ${MAPS[mi].name} [${mode}] ${ms}ms | 開砲 ${stats.shot}（自走砲 ${stats.arty}、特殊 ${stats.special}） 擊殺 ${stats.kill} 爆炸 ${stats.boom} 反彈 ${stats.bnc} 傳送 ${stats.port} 加速帶 ${stats.pad} 補給包 ${stats.supply} 空投 ${stats.drop}/${stats.crate} 空襲 ${stats.aircall} ${extra}`);
  }
}
console.log(`全部合計：空投 ${total.drop} 次（被搶走 ${total.crate} 次）、呼叫空襲 ${total.air} 次、補給包 ${total.supply} 個、自走砲開砲 ${total.arty} 次`);
if (!total.air || !total.arty || !total.crate) fail('電腦都沒有搶空投 / 呼叫空襲 / 用自走砲');
process.exit(failed ? 1 : 0);
