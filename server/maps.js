'use strict';
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
 *  S  出生點    P  道具刷新點    .  空地
 */
const Core = require('../shared/core');
const { T, TILE, C } = Core;

const MAPS = [
  {
    name: '十字戰場',
    sym: 'quad',
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
    sym: 'half',
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
    sym: 'quad',
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
    sym: 'half',
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
    sym: 'quad',
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
];

const CHAR = { '#': T.STEEL, B: T.BRICK, '~': T.WATER, ',': T.BUSH, X: T.BARREL, S: T.FLOOR, P: T.FLOOR, '.': T.FLOOR };

function expand(def) {
  const rev = (s) => s.split('').reverse().join('');
  if (def.sym === 'quad') {
    const top = def.rows.map((r) => r + rev(r));
    return top.concat(top.slice().reverse());
  }
  if (def.sym === 'half') {
    return def.rows.concat(def.rows.slice().reverse().map(rev));
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
  return { name: def.name, w, h, tiles, hp, spawns, powerSpots, rows };
}

module.exports = { MAPS, parseMap, expand };
