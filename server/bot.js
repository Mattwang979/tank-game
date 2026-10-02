'use strict';
/*
 * 電腦玩家：BFS 尋路、走位繞圈、預判射擊、閃避砲彈、埋地雷；困難難度會算反彈射擊。
 * 輸出和真人一樣的輸入（按鍵 + 瞄準角度），不作弊移動。
 */
const Core = require('../shared/core');
const { TILE, T, C, K } = Core;

const BOT_NAMES = ['鐵牛', '砲灰一號', '小鋼砲', '隔壁老王', '地雷王', '裝甲貓', '坦克殺手', '阿姆斯壯', '履帶君', '炸彈超人', '肉包', '無情鐵手'];

const LEVELS = {
  easy: { aimErr: 0.2, react: 0.6, dodge: 0.15, turn: 4, bank: false, mine: 0.05, fire: 0.5 },
  normal: { aimErr: 0.09, react: 0.35, dodge: 0.45, turn: 7, bank: false, mine: 0.1, fire: 0.8 },
  hard: { aimErr: 0.035, react: 0.18, dodge: 0.8, turn: 12, bank: true, mine: 0.16, fire: 1 },
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function bfs(map, sx, sy, gx, gy, allowBrick) {
  const w = map.w, h = map.h;
  const prev = new Int32Array(w * h).fill(-1);
  const start = sy * w + sx, goal = gy * w + gx;
  prev[start] = start;
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    if (i === goal) break;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (prev[j] !== -1) continue;
      const t = map.tiles[j];
      if (j !== goal && Core.blocksTank(t) && !(allowBrick && t === T.BRICK)) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let i = goal; i !== start; i = prev[i]) path.push({ x: i % w, y: (i / w) | 0 });
  return path.reverse();
}

class BotBrain {
  constructor(level) {
    this.level = LEVELS[level] ? level : 'normal';
    this.cfg = LEVELS[this.level];
    this.seq = 0;
    this.reset();
  }

  reset() {
    this.path = null; this.pathT = 0; this.goalKey = '';
    this.target = null; this.seenT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.lastX = 0; this.lastY = 0; this.checkT = 1; this.wanderT = 0; this.wanderA = 0;
    this.aim = null; this.err = 0; this.errT = 0;
    this.bankT = 0; this.bank = null;
    this.dodged = new Set(); this.dodgeT = 0; this.dodgeX = 0; this.dodgeY = 0;
    this.mineT = 2 + Math.random() * 3;
    this.brick = null; this.roam = null;
  }

  think(room, p, dt) {
    const cfg = this.cfg, map = room.map;
    const team = room.settings.mode === 'team';
    if (this.aim === null) this.aim = p.ta;
    let k = 0;

    // ---- 選目標
    let tgt = null, best = Infinity;
    for (const q of room.players.values()) {
      if (!q.alive || q === p || (team && q.team === p.team)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (q.inBush && q.revealT <= 0 && d > C.BUSH_SEE) continue;
      const s = d * (Core.lineClear(map, p.x, p.y, q.x, q.y) ? 0.6 : 1) * (q.protectT > 0 ? 3 : 1);
      if (s < best) { best = s; tgt = q; }
    }
    if (tgt !== this.target) { this.target = tgt; this.seenT = 0; }
    const los = !!tgt && Core.lineClear(map, p.x, p.y, tgt.x, tgt.y);
    this.seenT = los ? this.seenT + dt : 0;
    const d = tgt ? Math.hypot(tgt.x - p.x, tgt.y - p.y) : Infinity;

    // ---- 目的地
    let goal = null, pu = null, pd = Infinity;
    for (const u of room.powerups) {
      const ud = Math.hypot(u.x - p.x, u.y - p.y);
      const want = (p.hp < 55 && (u.k === 'heal' || u.k === 'shield')) ? ud * 0.4 : ud;
      if (want < pd) { pd = want; pu = u; }
    }
    if (pu && pd < 300) goal = pu;
    else if (tgt) goal = tgt;
    else {
      if (!this.roam || Math.hypot(this.roam.x - p.x, this.roam.y - p.y) < 30) {
        const spots = map.powerSpots.concat(map.spawns);
        this.roam = spots[Math.floor(Math.random() * spots.length)];
      }
      goal = this.roam;
    }

    // ---- 移動
    let mx = 0, my = 0;
    this.brick = null;
    if (los && goal === tgt && d < 430) {
      const ax = (tgt.x - p.x) / d, ay = (tgt.y - p.y) / d;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 0.6 + Math.random() * 1.4; }
      mx = -ay * this.strafe; my = ax * this.strafe;
      const rr = d < 200 ? -0.9 : d > 340 ? 0.8 : 0;
      mx += ax * rr; my += ay * rr;
    } else {
      const wp = this.nextWaypoint(map, p, goal, dt);
      if (wp) { mx = wp.x - p.x; my = wp.y - p.y; }
    }

    // 看得到的地雷：繞開
    for (const m of room.mines) {
      if (m.owner === p.id || (team && m.team === p.team) || !room.canSeeMine(p, m)) continue;
      const dx = p.x - m.x, dy = p.y - m.y, dd = Math.hypot(dx, dy);
      if (dd < 90 && dd > 0.1) {
        const ml = Math.hypot(mx, my) || 1;
        mx = mx / ml + (dx / dd) * 2; my = my / ml + (dy / dd) * 2;
      }
    }

    // 閃避砲彈
    this.dodgeT -= dt;
    for (const b of room.bullets) {
      if (b.owner === p.id && b.bounces === 0) continue;
      if (team && b.team === p.team && b.owner !== p.id) continue;
      if (this.dodged.has(b.id)) continue;
      const rx = p.x - b.x, ry = p.y - b.y;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      const t = (rx * b.vx + ry * b.vy) / v2;
      if (t < 0 || t > 0.55) continue;
      const cx = b.x + b.vx * t - p.x, cy = b.y + b.vy * t - p.y;
      if (Math.hypot(cx, cy) > C.TANK_R + 10) continue;
      this.dodged.add(b.id);
      if (Math.random() > cfg.dodge) continue;
      let px = -b.vy, py = b.vx;
      const pl = Math.hypot(px, py);
      px /= pl; py /= pl;
      if (px * -cx + py * -cy < 0 || (Math.abs(cx) + Math.abs(cy) < 1 && Math.random() < 0.5)) { px = -px; py = -py; }
      this.dodgeT = 0.3; this.dodgeX = px; this.dodgeY = py;
      if (p.dashCd <= 0 && t < 0.3 && Math.random() < cfg.dodge) k |= K.DASH;
    }
    if (this.dodged.size > 300) this.dodged.clear();
    if (this.dodgeT > 0) { mx = this.dodgeX; my = this.dodgeY; }

    // 卡住了就亂走一下
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.8;
      if (Math.hypot(p.x - this.lastX, p.y - this.lastY) < 12 && (mx || my) && !(los && d < 430)) {
        this.wanderT = 0.5; this.wanderA = Math.random() * Math.PI * 2; this.path = null;
      }
      this.lastX = p.x; this.lastY = p.y;
    }
    if (this.wanderT > 0) { this.wanderT -= dt; mx = Math.cos(this.wanderA); my = Math.sin(this.wanderA); }

    const ml = Math.hypot(mx, my);
    if (ml > 0.01) {
      const ca = mx / ml, sa = my / ml;
      if (ca > 0.38) k |= K.RIGHT;
      if (ca < -0.38) k |= K.LEFT;
      if (sa > 0.38) k |= K.DOWN;
      if (sa < -0.38) k |= K.UP;
    }

    // ---- 瞄準與開火
    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.4; this.err = (Math.random() * 2 - 1) * cfg.aimErr; }
    let desired = null, canFire = false;
    if (los) {
      const tt = d / C.BULLET_SPEED;
      const lx = tgt.x + (tgt.vx || 0) * tt * 0.9, ly = tgt.y + (tgt.vy || 0) * tt * 0.9;
      desired = Math.atan2(ly - p.y, lx - p.x) + this.err;
      canFire = this.seenT > cfg.react && d < 700 && tgt.protectT <= 0;
      this.bank = null;
    } else if (cfg.bank && tgt && d < 760) {
      this.bankT -= dt;
      if (this.bankT <= 0) { this.bankT = 0.35; this.bank = this.findBank(map, p, tgt); }
      if (this.bank !== null) { desired = this.bank; canFire = tgt.protectT <= 0; }
    }
    if (desired === null) {
      if (this.brick) { desired = Math.atan2(this.brick.y - p.y, this.brick.x - p.x); canFire = true; }
      else if (ml > 0.01) desired = Math.atan2(my, mx);
    }
    if (desired !== null) {
      const diff = Core.angDiff(desired, this.aim), mr = cfg.turn * dt;
      this.aim = Core.wrapAngle(this.aim + Core.clamp(diff, -mr, mr));
      if (canFire && Math.abs(Core.angDiff(desired, this.aim)) < 0.08 && Math.random() < cfg.fire) k |= K.FIRE;
    }
    if (p.ammo < 1 && p.railAmmo <= 0 && p.rapidT <= 0) k &= ~K.FIRE;

    // ---- 地雷
    this.mineT -= dt;
    if (this.mineT <= 0) {
      this.mineT = 1;
      if (p.mineAmmo > 0 && tgt && d < 240 && Math.random() < cfg.mine * 4) k |= K.MINE;
      else if (p.mineAmmo >= 2 && Math.random() < cfg.mine) k |= K.MINE;
    }

    return { s: ++this.seq, k, a: this.aim };
  }

  nextWaypoint(map, p, goal, dt) {
    if (!goal) return null;
    const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
    const gx = Math.floor(goal.x / TILE), gy = Math.floor(goal.y / TILE);
    const key = gx + ',' + gy;
    this.pathT -= dt;
    if (!this.path || this.pathT <= 0 || key !== this.goalKey) {
      this.pathT = 0.5;
      this.goalKey = key;
      this.path = bfs(map, sx, sy, gx, gy, false) || bfs(map, sx, sy, gx, gy, true);
    }
    const path = this.path;
    if (!path) return goal;
    const idx = path.findIndex((n) => n.x === sx && n.y === sy);
    if (idx >= 0) path.splice(0, idx + 1);
    if (!path.length) return goal;
    const n = path[0];
    const c = { x: n.x * TILE + TILE / 2, y: n.y * TILE + TILE / 2 };
    if (map.tiles[n.y * map.w + n.x] === T.BRICK) this.brick = c;
    return c;
  }

  // 困難電腦：找一個打一次牆反彈能命中的角度
  findBank(map, p, tgt) {
    let bestA = null, bestLen = Infinity;
    const N = 120;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const res = Core.castRay(map, p.x, p.y, a, 900, 1, false);
      const pts = res.pts;
      if (pts.length < 3) continue;
      let len = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      for (let s = 1; s < pts.length - 1; s++) {
        const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
        if (Core.segPointDist(x0, y0, x1, y1, tgt.x, tgt.y) < 12 && Core.segPointDist(x0, y0, x1, y1, p.x, p.y) > 34) {
          len += Math.hypot(tgt.x - x0, tgt.y - y0);
          if (len < bestLen) { bestLen = len; bestA = a; }
        }
      }
    }
    return bestA;
  }
}

module.exports = { BotBrain, BOT_NAMES, LEVELS };
