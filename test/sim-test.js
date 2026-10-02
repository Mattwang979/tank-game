'use strict';
// 無頭模擬：每張地圖放 6 隻電腦打一場，確認不會出錯、真的會互殺、會用道具和地雷
const { Room } = require('../server/game');
const { MAPS } = require('../server/maps');
const { C } = require('../shared/core');

let failed = false;
for (let mi = 0; mi < MAPS.length; mi++) {
  for (const mode of ['ffa', 'team']) {
    const room = new Room('TEST');
    room.settings.map = mi;
    room.settings.target = 999;
    room.settings.time = 180;
    const host = { name: 'host' };
    ['easy', 'normal', 'hard', 'normal', 'hard', 'easy'].forEach((l) => room.addBot(l));
    if (mode === 'team') room.command(host, { c: 'mode', v: 'team' });
    else room.startMatch();
    const stats = { shot: 0, kill: 0, mine: 0, pu: 0, boom: 0, bnc: 0, rail: 0, dash: 0, self: 0, clash: 0 };
    const ev = room.event.bind(room);
    room.event = (e) => {
      if (e.e in stats) stats[e.e]++;
      if (e.e === 'kill' && e.self) stats.self++;
      ev(e);
    };
    const ticks = 180 * 60;
    const t0 = Date.now();
    try {
      for (let i = 0; i < ticks; i++) {
        room.tick();
        for (const p of room.players.values()) {
          if (p.alive && (!isFinite(p.x) || !isFinite(p.y))) throw new Error(`NaN position for ${p.name}`);
          if (p.alive && (p.x < 0 || p.y < 0 || p.x > room.map.w * 40 || p.y > room.map.h * 40)) throw new Error(`${p.name} 跑出地圖`);
        }
      }
    } catch (e) {
      console.error(`✗ ${MAPS[mi].name} [${mode}]`, e);
      failed = true;
      continue;
    }
    const ms = Date.now() - t0;
    const board = [...room.players.values()].map((p) => `${p.name}(${p.bot.level[0]}) ${p.kills}/${p.deaths}`).join('  ');
    const ok = stats.kill > 5 && stats.shot > 50;
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${MAPS[mi].name} [${mode}] 3分鐘模擬 ${ms}ms | ${JSON.stringify(stats)}\n    ${board}`);
  }
}
process.exit(failed ? 1 : 0);
