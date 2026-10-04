'use strict';
// 預測一致性測試：模擬 150ms 延遲，客戶端用同一份物理預測自己的坦克，收到伺服器快照後校正。
// 開過冰面、加速帶、傳送門也不能出現校正跳動（跳動 = 預測和伺服器不一致）。
const { Room } = require('../shared/game');
const { MAPS } = require('../shared/maps');
const Core = require('../shared/core');
const { C, K, TILE } = Core;

const LAT = 9; // 單程延遲（tick），9 tick = 150ms
let failed = false;

function run(mapName, start, script) {
  const room = new Room('PRED');
  room.settings.map = MAPS.findIndex((m) => m.name === mapName);
  room.startMatch();
  room.puTimer = Infinity; // 不要刷道具：撿到加速引擎本來就會有短暫的預測誤差，這裡只測地形
  const p = room.addPlayer({ name: 'p', color: '#ff4d4d' });
  Object.assign(p, { x: start[0] * TILE + 20, y: start[1] * TILE + 20, vx: 0, vy: 0, protectT: 1e9 });
  const fields = ['x', 'y', 'vx', 'vy', 'ha', 'dashT', 'dashCd', 'slideT', 'portLock'];
  const snap = () => Object.assign(Object.fromEntries(fields.map((f) => [f, p[f]])), { ack: p.ack, boost: p.boostT > 0, spd: p.spd, r: p.r });
  let pred = snap();
  const pending = [], toServer = [], toClient = [];
  let seq = 0, maxJump = 0, ports = 0, pads = 0, ice = 0;
  for (let t = 0; t < script.length; t++) {
    const k = script[t];
    const s = ++seq;
    pending.push({ s, k });
    Core.stepTank(pred, k, C.DT, room.map);
    if (pred.justPorted) { ports++; pred.justPorted = null; }
    if (pred.justPadded) { pads++; pred.justPadded = false; }
    if (Core.tileAt(room.map, Math.floor(pred.x / TILE), Math.floor(pred.y / TILE)) === Core.T.ICE) ice++;
    toServer.push({ at: t + LAT, s, k });
    while (toServer.length && toServer[0].at <= t) { const m = toServer.shift(); room.input(p, [[m.s, m.k, 0]]); }
    room.tick();
    if (t % 2 === 0) toClient.push({ at: t + LAT, you: snap() });
    while (toClient.length && toClient[0].at <= t) {
      const y = toClient.shift().you;
      const before = { x: pred.x, y: pred.y };
      while (pending.length && pending[0].s <= y.ack) pending.shift();
      pred = Object.assign({}, y);
      for (const q of pending) Core.stepTank(pred, q.k, C.DT, room.map);
      pred.justPorted = null; pred.justPadded = false; pred.justDashed = false;
      const jump = Math.hypot(before.x - pred.x, before.y - pred.y);
      if (t > LAT * 3) maxJump = Math.max(maxJump, jump);
    }
  }
  return { maxJump, ports, pads, ice };
}

const hold = (k, n) => Array(n).fill(k);
const rnd = (n, seed) => {
  let x = seed, out = [];
  const keys = [K.UP, K.DOWN, K.LEFT, K.RIGHT, K.UP | K.RIGHT, K.DOWN | K.LEFT, K.UP | K.LEFT, K.DOWN | K.RIGHT, K.RIGHT | K.DASH];
  while (out.length < n) { x = (x * 1103515245 + 12345) & 0x7fffffff; out.push(...hold(keys[x % keys.length], 10 + (x % 25))); }
  return out.slice(0, n);
};
const cases = [
  ['傳送門（往右開進去）', '傳送迷城', [1, 3], hold(K.RIGHT, 240)],
  ['傳送門（亂開 40 秒）', '傳送迷城', [2, 2], rnd(2400, 7)],
  ['加速帶（亂開 40 秒）', '極速賽道', [4, 4], rnd(2400, 11)],
  ['冰面（亂開 40 秒）', '冰封湖面', [6, 6], rnd(2400, 3)],
];
for (const [name, map, start, script] of cases) {
  const r = run(map, start, script);
  const ok = r.maxJump < 0.5;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${name}：最大校正 ${r.maxJump.toFixed(3)}px（傳送 ${r.ports} 次、加速帶 ${r.pads} 次、冰上 ${(r.ice / 60).toFixed(1)} 秒）`);
}
process.exit(failed ? 1 : 0);
