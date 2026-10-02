'use strict';
// 檢查每張地圖：尺寸、邊界、出生點互通（不打破磚牆也走得到）
const { MAPS, parseMap } = require('../server/maps');
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
  // BFS from first spawn over tank-passable tiles
  const seen = new Uint8Array(m.w * m.h);
  const s0 = m.spawns[0];
  const q = [Math.floor(s0.y / TILE) * m.w + Math.floor(s0.x / TILE)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * m.w + x + dx;
      if (!seen[j] && !Core.blocksTank(m.tiles[j])) { seen[j] = 1; q.push(j); }
    }
  }
  for (const s of [...m.spawns, ...m.powerSpots]) {
    const i = Math.floor(s.y / TILE) * m.w + Math.floor(s.x / TILE);
    if (!seen[i]) errs.push(`(${Math.floor(s.x / TILE)},${Math.floor(s.y / TILE)}) 走不到`);
  }
  let unreachableFloor = 0;
  for (let i = 0; i < m.tiles.length; i++) if ((m.tiles[i] === T.FLOOR || m.tiles[i] === T.BUSH) && !seen[i]) unreachableFloor++;
  console.log(`${errs.length ? '✗' : '✓'} ${def.name}: 出生點 ${m.spawns.length}，道具點 ${m.powerSpots.length}，封閉空地 ${unreachableFloor} ${errs.join('; ')}`);
  if (errs.length) ok = false;
  if (process.argv.includes('-v')) console.log(m.rows.join('\n') + '\n');
}
process.exit(ok ? 0 : 1);
