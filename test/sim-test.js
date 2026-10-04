'use strict';
// 無頭模擬：每張地圖 × 每種模式放 6 隻電腦打一場，確認不會出錯、真的會交戰，而且各模式的目標真的有在進行
const { Room, MODES, createClient } = require('../shared/game');
const { MAPS } = require('../shared/maps');
const { C } = require('../shared/core');

let failed = false;
const fail = (msg) => { console.error('✗ ' + msg); failed = true; };

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
  else console.log('✓ 三連發 3 顆砲彈都飛出去了');
}

// ---- 連線協定：假的連線收到的每個訊息都要是合法 JSON，快照裡要有目標狀態
{
  const room = new Room('NET');
  const got = [];
  const sock = { readyState: 1, bufferedAmount: 0, send: (s) => got.push(JSON.parse(s)) };
  const cl = createClient(sock, () => room);
  cl.message(JSON.stringify({ t: 'join', name: '測試', color: '#ff4d4d', skin: 'gold', room: 'NET' }));
  for (const mode of Object.keys(MODES)) {
    cl.message({ t: 'cmd', c: 'mode', v: mode });
    cl.message({ t: 'cmd', c: 'addbot', v: 'hard' });
    for (let i = 0; i < 120; i++) room.tick();
  }
  const snaps = got.filter((m) => m.t === 's');
  const welcome = got.find((m) => m.t === 'welcome');
  const info = got.filter((m) => m.t === 'info').pop();
  if (!welcome || !snaps.length || !info) fail('沒有收到 welcome / 快照 / info');
  else if (!snaps.some((s) => s.O && s.O.f) || !snaps.some((s) => s.O && s.O.z) || !snaps.some((s) => s.O && s.O.w !== undefined)) fail('快照裡缺少模式目標狀態');
  else if (info.players.find((x) => x.id === welcome.id).sk !== 'gold') fail('坦克外觀沒有傳出去');
  else console.log(`✓ 連線協定：${snaps.length} 個快照、${got.length} 個訊息都正常`);
}

// ---- 每張地圖 × 每種模式
const SECONDS = 150;
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
    const stats = { shot: 0, kill: 0, mine: 0, pu: 0, boom: 0, bnc: 0, rail: 0, dash: 0, self: 0, clash: 0, port: 0, pad: 0, take: 0, cap: 0, ret: 0, brWin: 0, waveClear: 0, special: 0 };
    const ev = room.event.bind(room);
    room.event = (e) => {
      if (e.e in stats) stats[e.e]++;
      if (e.e === 'kill' && e.self) stats.self++;
      if (e.e === 'flag') stats[e.a] = (stats[e.a] || 0) + 1;
      if (e.e === 'round' && e.w) stats.brWin++;
      if (e.e === 'wave' && e.a === 'clear') stats.waveClear++;
      if (e.e === 'shot' && e.k >= 2) stats.special++;
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
    const checks = [stats.shot > 50, stats.kill > 5];
    let extra = '';
    if (mode === 'ctf') { checks.push(stats.take > 0); extra = `搶旗 ${stats.take} 次、得分 ${stats.cap} 次、奪回 ${stats.ret} 次`; }
    if (mode === 'koth') { checks.push(maxHill > 5); extra = `最高佔山 ${maxHill.toFixed(0)} 秒`; }
    if (mode === 'br') { checks.push(stats.brWin >= 2); extra = `打完 ${room.obj.round} 回合（${stats.brWin} 回合有贏家）`; }
    if (mode === 'waves') { checks.push(room.obj.wave >= 2); extra = `打到第 ${room.obj.wave} 波${room.state !== 'playing' ? '（生命用完）' : ''}`; }
    const ok = checks.every(Boolean);
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${MAPS[mi].name} [${mode}] ${ms}ms | 開砲 ${stats.shot}（特殊 ${stats.special}） 擊殺 ${stats.kill} 爆炸 ${stats.boom} 反彈 ${stats.bnc} 傳送 ${stats.port} 加速帶 ${stats.pad} ${extra}`);
  }
}
process.exit(failed ? 1 : 0);
