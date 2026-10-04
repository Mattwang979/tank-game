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
 *  O  傳送門（和地圖中心對稱的那個傳送門相連，坦克和砲彈都會被傳過去）
 *  > < ^ v  加速帶（往箭頭方向把坦克彈出去；鏡射時箭頭會自動翻轉）
 *  S  出生點    P  道具刷新點    .  空地
 *
 * 其他欄位：
 *  theme  地面風格（grass / jungle / metal / desert / factory / snow / neon / asphalt）
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
      name: '冰封湖面',
      sym: 'quad', theme: 'snow', flag: [1, 9], hills: [[16, 10], [5.5, 8.5], [26.5, 11.5]],
      rows: [
        '################',
        '#S.....,,.......',
        '#......,,..##.X.',
        '#..##.......#...',
        '#..#..iiiiii....',
        '#....iiiiiiiiiii',
        '#,,..ii~~iiiiiii',
        '#,,..iiiiii##iii',
        '#....P.iiiiiiiii',
        '#.S..,,.iiiiiiii',
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
    i: T.ICE, O: T.PORTAL, '>': T.PAD_R, '<': T.PAD_L, v: T.PAD_D, '^': T.PAD_U,
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
    return { name: def.name, theme: def.theme || 'grass', w, h, tiles, hp, spawns, powerSpots, flags, hills, rows };
  }

  return { MAPS, parseMap, expand };
});
