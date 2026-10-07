/*
 * 地圖：32 x 20 格（每格 40px）。為了公平，全部是對稱地圖。
 *  quad: 只畫左上 16x10，自動左右 + 上下鏡射
 *  half: 畫上半 32x10，下半自動做 180 度旋轉
 *
 *  #  鋼牆（打不壞、砲彈會反彈）
 *  B  磚牆（打 3 下會碎）
 *  ~  水（坦克過不去，砲彈飛得過）
 *  ,  草叢（躲在裡面敵人看不到你）
 *  X  油桶（打到會爆炸，還會連鎖）
 *  i  冰面（會滑！轉彎和煞車都變慢）
 *  L  岩漿（開得進去，但會一直燒血、速度變慢；砲彈飛得過）
 *  O  傳送門（和地圖中心對稱的那個傳送門相連，坦克和砲彈都會被傳過去）
 *  > < ^ v  加速帶（往箭頭方向把坦克彈出去；鏡射時箭頭會自動翻轉）
 *  S  出生點    P  道具刷新點    .  空地
 *
 * 其他欄位：
 *  theme  地面風格（grass / jungle / metal / desert / factory / snow / neon / asphalt / lava）
 *  flag   搶旗模式紅隊旗座的格子 [x, y]（藍隊自動放在 180° 對稱的位置）
 *  hills  山丘之王的山頭中心（以格子為單位，可以有小數；[16, 10] 是地圖正中央），依序輪流出現
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core'));
  else root.TBMaps = factory(root.Core);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const { T, TILE, C } = Core;

  const MAPS = [
    {
      name: '十字戰場',
      sym: 'quad', theme: 'grass', flag: [1, 9], hills: [[16, 10], [9.5, 7.5], [22.5, 12.5]],
      rows: [
        '################',
        '#S.....,,,......',
        '#......,,,..B...',
        '#..##.......B...',
        '#..#X...~~~.....',
        '#.......~~~..##.',
        '#,,..BB......#..',
        '#,,..B...P...#..',
        '#.......,,......',
        '#.S.##..,,....X.',
      ],
    },
    {
      name: '叢林伏擊',
      sym: 'half', theme: 'jungle', flag: [1, 10], hills: [[16, 10], [15.5, 2.5], [16.5, 17.5], [3.5, 8.5], [28.5, 11.5]],
      rows: [
        '################################',
        '#S..,,,,....#........#....,,,..#',
        '#...,,,,....#..P.....B....,,,..#',
        '#..~~~...........XX..B.........#',
        '#..~~~...,,.BBB..........##....#',
        '#,,.....#,,........,,,...#..S..#',
        '#,,.X...#.....~~~~.,,,......,,,#',
        '#....BB.......~~~~....BB....,,,#',
        '#..P.......,,,..........#......#',
        '#.S........,,,....##....#..X...#',
      ],
    },
    {
      name: '鋼鐵迷宮',
      sym: 'quad', theme: 'metal', flag: [2, 9], hills: [[16, 10], [5.5, 7.5], [26.5, 12.5]],
      rows: [
        '################',
        '#S....#.........',
        '#.##..#..####...',
        '#.#.....,,..#...',
        '#...##..,,..#.B.',
        '#.X..#......BBB.',
        '##...#.###......',
        '#....P.#.....,,.',
        '#.S..#.#..X..,,.',
        '#....#....#.....',
      ],
    },
    {
      name: '磚城攻防',
      sym: 'half', theme: 'desert', flag: [1, 9], hills: [[16, 10], [3.5, 5.5], [28.5, 14.5]],
      rows: [
        '################################',
        '#S..B.....,,.......,,.....B..S.#',
        '#...B.....,,..BBB..,,.....B....#',
        '#BB.B....................BB.BB.#',
        '#.......~~~....X....~~~........#',
        '#..P....~~~..BBBBB..~~~....P...#',
        '#.........,,..........,,.......#',
        '#..BB..X..,,...###....,,..X..BB#',
        '#S.BB..........#P#.............#',
        '#..........,,.......,,.........#',
      ],
    },
    {
      name: '油桶工廠',
      sym: 'quad', theme: 'factory', flag: [4, 9], hills: [[8.5, 7.5], [23.5, 12.5], [23.5, 7.5], [8.5, 12.5]],
      rows: [
        '################',
        '#S.......#......',
        '#..X..X..#..,,,.',
        '#........B..,,,.',
        '#.###..........X',
        '#...#..~~..BB...',
        '#.X.#..~~..B..X.',
        '#.......P.......',
        '#,,,..#....###..',
        '#,S,..#X.......X',
      ],
    },
    {
      // 2.2：取代冰封湖面。中間是被岩漿圍起來的火山島（四座兩格寬的橋），四個角落有岩漿裂縫和岩漿池
      name: '熔岩火山',
      sym: 'quad', theme: 'lava', flag: [1, 9], hills: [[16, 10], [10.5, 6.5], [21.5, 13.5]],
      rows: [
        '################',
        '#S......L.......',
        '#.........,,..X.',
        '#..##...L.,,....',
        '#..#....LL......',
        '#............BB.',
        '#,,..LL.....LLL.',
        '#,,..LX..P..L...',
        '#...........L.#.',
        '#.S..#..........',
      ],
    },
    {
      name: '傳送迷城',
      sym: 'half', theme: 'neon', flag: [1, 9], hills: [[16, 10], [5.5, 8.5], [26.5, 11.5]],
      rows: [
        '################################',
        '#S.......#..........#.......,,S#',
        '#........#..BB..BB..#.......,,.#',
        '#..O.....#..........#.....O....#',
        '#....#####....,,....#####......#',
        '#..............X...............#',
        '#..BB....,,..#....#..,,....BB..#',
        '#.X......,,..#.O..#..,,......X.#',
        '#....P.......#....#.......P....#',
        '#.S....####..........####....S.#',
      ],
    },
    {
      name: '極速賽道',
      sym: 'half', theme: 'asphalt', flag: [1, 9], hills: [[16, 10], [16, 4.5], [16, 15.5]],
      rows: [
        '################################',
        '#S.......,,.........,,.......S.#',
        '#..P.....,,....X....,,.....P...#',
        '#....>>>>>>>>>>>>>>>>>>>>>v....#',
        '#....^....................v....#',
        '#,,..^..##....,,,,....##..v..,,#',
        '#,,..^..#.....,,,,.....#..v..,,#',
        '#....^....X..........X....v....#',
        '#....^...BB....##....BB...v....#',
        '#.S..^....................v..S.#',
      ],
    },
  ];

  const CHAR = {
    '#': T.STEEL, B: T.BRICK, '~': T.WATER, ',': T.BUSH, X: T.BARREL, S: T.FLOOR, P: T.FLOOR, '.': T.FLOOR,
    i: T.ICE, O: T.PORTAL, '>': T.PAD_R, '<': T.PAD_L, v: T.PAD_D, '^': T.PAD_U, L: T.LAVA,
  };

  // 鏡射時加速帶的箭頭要跟著翻
  const FLIP_H = { '>': '<', '<': '>' };
  const FLIP_V = { '^': 'v', v: '^' };
  const mapChars = (s, f) => s.split('').map((c) => f[c] || c).join('');
  const revH = (s) => mapChars(s.split('').reverse().join(''), FLIP_H);

  function expand(def) {
    if (def.sym === 'quad') {
      const top = def.rows.map((r) => r + revH(r));
      return top.concat(top.slice().reverse().map((r) => mapChars(r, FLIP_V)));
    }
    if (def.sym === 'half') {
      return def.rows.concat(def.rows.slice().reverse().map((r) => mapChars(revH(r), FLIP_V)));
    }
    return def.rows.slice();
  }

  function parseMap(def) {
    const rows = expand(def);
    const h = rows.length, w = rows[0].length;
    const tiles = new Uint8Array(w * h);
    const hp = new Uint8Array(w * h);
    const spawns = [], powerSpots = [];
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error(`地圖「${def.name}」第 ${y} 列長度 ${rows[y].length} ≠ ${w}`);
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (!(ch in CHAR)) throw new Error(`地圖「${def.name}」未知字元 '${ch}'`);
        const t = CHAR[ch];
        tiles[y * w + x] = t;
        if (t === T.BRICK) hp[y * w + x] = C.BRICK_HP;
        const c = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
        if (ch === 'S') spawns.push(c);
        if (ch === 'P') powerSpots.push(c);
      }
    }
    const f = def.flag || [1, Math.floor(h / 2) - 1];
    const flags = [
      { x: f[0] * TILE + TILE / 2, y: f[1] * TILE + TILE / 2 },
      { x: (w - 1 - f[0]) * TILE + TILE / 2, y: (h - 1 - f[1]) * TILE + TILE / 2 },
    ];
    const hills = (def.hills || [[w / 2, h / 2]]).map(([x, y]) => ({ x: x * TILE, y: y * TILE }));
    const m = { name: def.name, theme: def.theme || 'grass', w, h, tiles, hp, spawns, powerSpots, flags, hills, rows };
    const s0 = spawns[0];
    m.reach = reachable(m, Math.floor(s0.y / TILE) * w + Math.floor(s0.x / TILE));
    const sp = pickSpots(m, 8);
    m.supplySpots = sp.supply;
    m.dropSpots = sp.drops;
    return m;
  }

  // 坦克走得到的格子（踩進傳送門會被傳到對面）
  function reachable(m, start) {
    const { w, h, tiles } = m;
    const seen = new Uint8Array(w * h);
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      let i = q.pop();
      let x = i % w, y = (i / w) | 0;
      if (tiles[i] === T.PORTAL) { [x, y] = Core.portalPartner(m, x, y); i = y * w + x; seen[i] = 1; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && !Core.blocksTank(tiles[j])) { seen[j] = 1; q.push(j); }
      }
    }
    return seen;
  }

  // 補給包的位置：四周沒有障礙的空地、離出生點 / 道具點 / 旗座有點距離、180° 對稱成對出現，
  // 用「最遠點取樣」平均分散（結果是固定的，每次載入同一張地圖都一樣）。
  // 順便回傳空投可以掉落的格子（所有開闊、走得到的空地）。
  function pickSpots(m, n) {
    const { w, h, tiles } = m;
    const open = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !Core.blocksTank(Core.tileAt(m, x + dx, y + dy)));
    const avoid = m.spawns.map((s) => [s, 3.5 * TILE]).concat(m.powerSpots.map((s) => [s, 3 * TILE]), m.flags.map((s) => [s, 2.5 * TILE]));
    const drops = [], byKey = new Map();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (tiles[i] !== T.FLOOR || !m.reach[i] || !open(x, y)) continue;
        const c = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, i, p: (h - 1 - y) * w + (w - 1 - x) };
        drops.push({ x: c.x, y: c.y });
        if (avoid.some(([s, r]) => Math.hypot(s.x - c.x, s.y - c.y) < r)) continue;
        // 跟自己的對稱點太近（地圖正中央附近）的不要，不然兩包會黏在一起
        if (Math.hypot((w - 1 - 2 * x) * TILE, (h - 1 - 2 * y) * TILE) < 4 * TILE) continue;
        byKey.set(i, c);
      }
    }
    const chosen = [];
    const take = (c) => {
      chosen.push(c); byKey.delete(c.i);
      const p = byKey.get(c.p);
      if (p) { chosen.push(p); byKey.delete(p.i); }
    };
    const cx = (w * TILE) / 2, cy = (h * TILE) / 2;
    let first = null, fd = Infinity;
    for (const c of byKey.values()) { const d = Math.hypot(c.x - cx, c.y - cy); if (d < fd) { fd = d; first = c; } }
    if (first) take(first);
    while (chosen.length < n && byKey.size) {
      let best = null, bd = -1;
      for (const c of byKey.values()) {
        let d = Infinity;
        for (const o of chosen) d = Math.min(d, Math.hypot(o.x - c.x, o.y - c.y));
        for (const o of m.powerSpots) d = Math.min(d, Math.hypot(o.x - c.x, o.y - c.y) * 1.3);
        if (d > bd) { bd = d; best = c; }
      }
      take(best);
    }
    return { supply: chosen.map((c) => ({ x: c.x, y: c.y })), drops };
  }

  return { MAPS, parseMap, expand };
});
