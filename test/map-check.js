'use strict';
// 檢查每張地圖：尺寸、邊界、出生點互通（不打破磚牆也走得到）、旗座、山頭、傳送門配對
const { MAPS, parseMap } = require('../shared/maps');
const Core = require('../shared/core');
const { T, TILE } = Core;

let ok = true;
for (const def of MAPS) {
  let m;
  try { m = parseMap(def); } catch (e) { console.log('✗', e.message); ok = false; continue; }
  const errs = [];
  if (m.w !== 32 || m.h !== 20) errs.push(`尺寸 ${m.w}x${m.h}`);
  for (let x = 0; x < m.w; x++) {
    if (m.tiles[x] !== T.STEEL || m.tiles[(m.h - 1) * m.w + x] !== T.STEEL) { errs.push('上下邊界不完整'); break; }
  }
  for (let y = 0; y < m.h; y++) {
    if (m.tiles[y * m.w] !== T.STEEL || m.tiles[y * m.w + m.w - 1] !== T.STEEL) { errs.push('左右邊界不完整'); break; }
  }
  // 傳送門一定要成對
  let portals = 0;
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i] !== T.PORTAL) continue;
    portals++;
    const [px, py] = Core.portalPartner(m, i % m.w, (i / m.w) | 0);
    if (m.tiles[py * m.w + px] !== T.PORTAL) errs.push(`傳送門 (${i % m.w},${(i / m.w) | 0}) 沒有配對`);
  }
  // 從第一個出生點 BFS（坦克走得到的格子；踩進傳送門會被傳到對面）
  const seen = new Uint8Array(m.w * m.h);
  const s0 = m.spawns[0];
  const q = [Math.floor(s0.y / TILE) * m.w + Math.floor(s0.x / TILE)];
  seen[q[0]] = 1;
  while (q.length) {
    let i = q.pop();
    let x = i % m.w, y = (i / m.w) | 0;
    if (m.tiles[i] === T.PORTAL) {
      [x, y] = Core.portalPartner(m, x, y);
      i = y * m.w + x;
      seen[i] = 1;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * m.w + x + dx;
      if (!seen[j] && !Core.blocksTank(m.tiles[j])) { seen[j] = 1; q.push(j); }
    }
  }
  const cell = (p) => Math.floor(p.y / TILE) * m.w + Math.floor(p.x / TILE);
  for (const s of [...m.spawns, ...m.powerSpots]) {
    if (!seen[cell(s)]) errs.push(`(${Math.floor(s.x / TILE)},${Math.floor(s.y / TILE)}) 走不到`);
  }
  m.flags.forEach((f, t) => {
    const i = cell(f);
    if (m.tiles[i] !== T.FLOOR || !seen[i]) errs.push(`${t ? '藍' : '紅'}旗座不在走得到的空地上`);
    if (t === 0 && f.x >= (m.w * TILE) / 2) errs.push('紅旗座要在左半邊');
  });
  for (const h of m.hills) {
    const i = cell(h);
    if (h.x < TILE || h.y < TILE || h.x > (m.w - 1) * TILE || h.y > (m.h - 1) * TILE) errs.push('山頭在地圖外');
    else if (Core.blocksTank(m.tiles[i]) || !seen[i]) errs.push(`山頭 (${h.x / TILE},${h.y / TILE}) 站不上去`);
  }
  let unreachableFloor = 0;
  for (let i = 0; i < m.tiles.length; i++) if (!Core.blocksTank(m.tiles[i]) && !seen[i]) unreachableFloor++;
  if (unreachableFloor) errs.push(`有 ${unreachableFloor} 格空地走不到`);
  console.log(`${errs.length ? '✗' : '✓'} ${def.name}（${m.theme}）: 出生點 ${m.spawns.length}，道具點 ${m.powerSpots.length}，山頭 ${m.hills.length}，傳送門 ${portals} ${errs.join('; ')}`);
  if (errs.length) ok = false;
  if (process.argv.includes('-v')) console.log(m.rows.join('\n') + '\n');
}
process.exit(ok ? 0 : 1);
