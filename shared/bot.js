/*
 * 電腦玩家：BFS 尋路（會走傳送門）、走位繞圈、預判射擊、閃避砲彈、埋地雷；困難難度會算反彈射擊。
 * 會用特殊武器，也會玩搶旗、佔山頭、躲毒圈；會開各種坦克（自走砲會拋射越過牆）、搶空投、呼叫空襲、躲落點紅圈。
 * 輸出和真人一樣的輸入（按鍵 + 瞄準角度），不作弊移動。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core'));
  else root.TBBot = factory(root.Core);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const { TILE, T, C, K } = Core;

  const BOT_NAMES = ['鐵牛', '砲灰一號', '小鋼砲', '隔壁老王', '地雷王', '裝甲貓', '坦克殺手', '阿姆斯壯', '履帶君', '炸彈超人', '肉包', '無情鐵手'];

  const LEVELS = {
    easy: { aimErr: 0.2, react: 0.6, dodge: 0.15, turn: 4, bank: false, mine: 0.05, fire: 0.5 },
    normal: { aimErr: 0.09, react: 0.35, dodge: 0.45, turn: 7, bank: false, mine: 0.1, fire: 0.8 },
    hard: { aimErr: 0.035, react: 0.18, dodge: 0.8, turn: 12, bank: true, mine: 0.16, fire: 1 },
    boss: { aimErr: 0.06, react: 0.25, dodge: 0, turn: 5, bank: true, mine: 0.3, fire: 1 },
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
      let x = i % w, y = (i / w) | 0;
      // 踩進傳送門會被傳到對面，所以從對面那格繼續往外找
      if (i !== start && map.tiles[i] === T.PORTAL) [x, y] = Core.portalPartner(map, x, y);
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
      this.role = 'att';
      this.spot = null; this.spotT = 0;
      this.px = null; this.py = null;
      this.trackT = 0; this.aimDist = 300; this.distErr = 0;
      this.airT = 1 + Math.random() * 2;
      this.dodgedShell = new Set();
    }

    // 模式目標：回傳 { x, y, urgent }，urgent 代表就算有敵人也先去目標
    objective(room, p, dt) {
      const o = room.obj;
      if (!o) return null;
      const mode = room.settings.mode;
      const near = (x, y, r) => {
        this.spotT -= dt;
        if (!this.spot || this.spotT <= 0 || Math.hypot(this.spot.x - p.x, this.spot.y - p.y) < 24) {
          this.spotT = 1.5 + Math.random() * 2;
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.random() * r;
            const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
            if (!Core.blocksTank(Core.tileAt(room.map, Math.floor(sx / TILE), Math.floor(sy / TILE)))) { this.spot = { x: sx, y: sy }; break; }
          }
          if (!this.spot) this.spot = { x, y };
        }
        return this.spot;
      };
      if (mode === 'ctf') {
        // 角色按隊伍分配，避免整隊電腦都留守（以前各自隨機，約 6% 的場次整隊都在家）
        const mates = [...room.players.values()].filter((q) => q.bot && q.team === p.team).sort((a, b) => a.id - b.id);
        this.role = mates.indexOf(p) >= mates.length - Math.floor(mates.length / 3) ? 'def' : 'att';
        const mine = o.flags[p.team], theirs = o.flags[1 - p.team];
        if (p.carry >= 0) return { x: mine.hx, y: mine.hy, urgent: true };
        if (mine.st === 2) return { x: mine.x, y: mine.y, urgent: true };
        if (mine.st === 1) { const c = room.players.get(mine.by); if (c) return { x: c.x, y: c.y }; }
        if (theirs.st === 2 && Math.hypot(theirs.x - p.x, theirs.y - p.y) < 520) return { x: theirs.x, y: theirs.y, urgent: true };
        if (this.role === 'att') {
          if (theirs.st === 1) { const c = room.players.get(theirs.by); if (c) return { x: c.x, y: c.y }; }
          // 已經摸到敵方旗座附近就不要戀戰，直接搶
          return { x: theirs.x, y: theirs.y, urgent: Math.hypot(theirs.x - p.x, theirs.y - p.y) < 280 };
        }
        return near(mine.hx, mine.hy, 110);
      }
      if (mode === 'koth') {
        const inside = Math.hypot(p.x - o.x, p.y - o.y) < o.r * 0.8;
        if (!inside) return { x: o.x, y: o.y, urgent: Math.hypot(p.x - o.x, p.y - o.y) < o.r * 2.2 };
        return Object.assign({ urgent: true }, near(o.x, o.y, o.r * 0.55));
      }
      if (mode === 'br' && o.z) {
        const z = o.z;
        const dz = Math.hypot(p.x - z.cx, p.y - z.cy);
        if (dz > z.r - 50) return { x: z.cx, y: z.cy, urgent: true };
        if (z.phase !== 'done' && z.tr > 0 && z.t < 7 && Math.hypot(p.x - z.tx, p.y - z.ty) > z.tr - 40) return { x: z.tx, y: z.ty, urgent: z.phase === 'shrink' || z.t < 3 };
      }
      return null;
    }

    think(room, p, dt) {
      const cfg = this.cfg, map = room.map;
      const team = room.isTeam();
      const mode = room.settings.mode;
      if (this.aim === null) this.aim = p.ta;
      // 被傳送門或爆炸推走了就重新找路
      if (this.px !== null && Math.hypot(p.x - this.px, p.y - this.py) > 60) this.path = null;
      this.px = p.x; this.py = p.y;
      let k = 0;

      // ---- 選目標
      let tgt = null, best = Infinity;
      const hill = mode === 'koth' ? room.obj : null;
      const sp = p.special;
      // 自走砲（沒拿特殊武器的時候）：砲彈拋過牆，不用看得到直線
      const arty = p.cls === 'spg' && !sp && !p.boss;
      let foes = 0;
      for (const q of room.players.values()) {
        if (!q.alive || q === p || (team && q.team === p.team)) continue;
        foes++;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (room.hidden(q) && d > (p.see || C.BUSH_SEE)) continue;
        const clear = Core.lineClear(map, p.x, p.y, q.x, q.y);
        let s = d * (clear || arty ? 0.6 : 1) * (q.protectT > 0 ? 3 : 1);
        if (arty && (d < C.ARTY_MIN || d > C.ARTY_MAX)) s *= 1.6;
        if (q.carry >= 0) s *= 0.4;
        if (hill && Math.hypot(q.x - hill.x, q.y - hill.y) < hill.r) s *= 0.6;
        if (s < best) { best = s; tgt = q; }
      }
      if (tgt !== this.target) { this.target = tgt; this.seenT = 0; this.trackT = 0; }
      const los = !!tgt && Core.lineClear(map, p.x, p.y, tgt.x, tgt.y);
      this.seenT = los ? this.seenT + dt : 0;
      this.trackT = tgt ? this.trackT + dt : 0;
      const d = tgt ? Math.hypot(tgt.x - p.x, tgt.y - p.y) : Infinity;
      const close = sp === 'shotgun' || sp === 'flame';

      // ---- 目的地（空投箱很搶手；血少或沒彈藥會去拿補給包）
      let pu = null, pd = Infinity;
      for (const u of room.powerups) {
        if (u.k === 'crate' && p.enemy) continue;
        const ud = Math.hypot(u.x - p.x, u.y - p.y);
        let want = ud;
        if (p.hp < p.maxHp * 0.55 && (u.k === 'heal' || u.k === 'shield' || u.k === 'supply')) want = ud * 0.4;
        else if (u.k === 'crate') want = ud * 0.45;
        else if (u.k === 'supply' && p.ammo < 1) want = ud * 0.6;
        if (want < pd) { pd = want; pu = u; }
      }
      const obj = this.objective(room, p, dt);
      let goal;
      if (obj && obj.urgent) goal = obj;
      else if (pu && pd < (obj ? 220 : 300)) goal = pu;
      else if (obj) goal = tgt && los && d < 340 ? tgt : obj;
      else if (tgt) goal = tgt;
      else {
        if (!this.roam || Math.hypot(this.roam.x - p.x, this.roam.y - p.y) < 30) {
          const spots = map.powerSpots.concat(map.spawns);
          this.roam = spots[Math.floor(Math.random() * spots.length)];
        }
        goal = this.roam;
      }

      // ---- 移動（不同坦克種類保持不同的交戰距離）
      let mx = 0, my = 0;
      this.brick = null;
      const cls = p.cls;
      const engage = goal === tgt && (arty ? d < C.ARTY_MAX - 30 : los && d < (cls === 'td' ? 560 : 430));
      if (engage) {
        const ax = (tgt.x - p.x) / d, ay = (tgt.y - p.y) / d;
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = (cls === 'light' ? 0.4 : 0.6) + Math.random() * 1.4; }
        const sw = arty ? 0.5 : cls === 'heavy' ? 0.7 : 1;
        mx = -ay * this.strafe * sw; my = ax * this.strafe * sw;
        // 霰彈和火焰要貼近打，自走砲和驅逐戰車躲遠一點，重坦往前推
        let rr;
        if (sp === 'flame') rr = d > C.FLAME_RANGE - 40 ? 1.1 : d < 70 ? -0.5 : 0.2;
        else if (sp === 'shotgun') rr = d > 130 ? 1.1 : d < 60 ? -0.5 : 0.2;
        else if (arty) rr = d < 280 ? -1.1 : d > 500 ? 0.6 : 0;
        else if (cls === 'td') rr = d < 320 ? -0.9 : d > 520 ? 0.7 : 0;
        else if (cls === 'heavy') rr = d < 150 ? -0.5 : d > 280 ? 0.9 : 0.15;
        else rr = d < 200 ? -0.9 : d > 340 ? 0.8 : 0;
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
        if (Math.hypot(cx, cy) > p.r + (b.kind === 2 ? 30 : 10)) continue;
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
      // 躲自走砲落點和空襲紅圈（隊友的空襲炸不到自己，不用躲）
      for (const s of room.shells) {
        if (s.t < 0 || s.tx === null || s.T - s.t > 0.95 || this.dodgedShell.has(s.id)) continue;
        if (s.kind === 1 && (s.owner === p.id || (team && s.team === p.team))) continue;
        const dx = p.x - s.tx, dy = p.y - s.ty, dd = Math.hypot(dx, dy);
        if (dd > s.r + p.r) continue;
        this.dodgedShell.add(s.id);
        if (Math.random() > cfg.dodge) continue;
        const a = dd > 1 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
        this.dodgeT = 0.45; this.dodgeX = Math.cos(a); this.dodgeY = Math.sin(a);
        if (p.dashCd <= 0 && s.T - s.t < 0.45 && Math.random() < cfg.dodge) k |= K.DASH;
      }
      if (this.dodgedShell.size > 300) this.dodgedShell.clear();
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
      // 扛旗被追的時候衝刺
      if (p.carry >= 0 && tgt && d < 260 && p.dashCd <= 0 && Math.random() < 0.03) k |= K.DASH;

      // ---- 瞄準與開火
      this.errT -= dt;
      if (this.errT <= 0) { this.errT = 0.4; this.err = (Math.random() * 2 - 1) * cfg.aimErr; this.distErr = (Math.random() * 2 - 1) * cfg.aimErr * 260; }
      let desired = null, canFire = false, tol = 0.08;
      const range = sp === 'shotgun' ? 200 : sp === 'flame' ? C.FLAME_RANGE - 15 : sp === 'homing' ? 560 : cls === 'td' ? 900 : 700;
      if (arty && tgt) {
        // 自走砲：預判對方落地時會在哪，算角度和距離（距離也有誤差）
        const ft = C.ARTY_T0 + d / C.ARTY_SPD;
        const lx = tgt.x + (tgt.vx || 0) * ft * 0.8, ly = tgt.y + (tgt.vy || 0) * ft * 0.8;
        desired = Math.atan2(ly - p.y, lx - p.x) + this.err * 0.5;
        this.aimDist = Core.clamp(Math.hypot(lx - p.x, ly - p.y) + this.distErr, C.ARTY_MIN, C.ARTY_MAX);
        canFire = this.trackT > cfg.react + 0.2 && d > C.ARTY_MIN - 20 && d < C.ARTY_MAX + 40 && tgt.protectT <= 0;
        tol = 0.12;
        this.bank = null;
      } else if (los) {
        const spd = sp === 'homing' ? C.MISSILE_SPEED : p.bspd || C.BULLET_SPEED;
        const tt = sp === 'flame' || sp === 'rail' ? 0 : d / spd;
        const lx = tgt.x + (tgt.vx || 0) * tt * 0.9, ly = tgt.y + (tgt.vy || 0) * tt * 0.9;
        desired = Math.atan2(ly - p.y, lx - p.x) + this.err;
        canFire = this.seenT > cfg.react && d < range && tgt.protectT <= 0;
        if (close || sp === 'homing') tol = 0.3;
        this.bank = null;
      } else if (cfg.bank && tgt && d < 760 && (!sp || sp === 'rail') && !arty) {
        this.bankT -= dt;
        if (this.bankT <= 0) { this.bankT = 0.35; this.bank = this.findBank(map, p, tgt); }
        if (this.bank !== null) { desired = this.bank; canFire = tgt.protectT <= 0; }
      }
      if (desired === null) {
        if (this.brick && !sp) {
          desired = Math.atan2(this.brick.y - p.y, this.brick.x - p.x);
          this.aimDist = Core.clamp(Math.hypot(this.brick.x - p.x, this.brick.y - p.y), C.ARTY_MIN, C.ARTY_MAX);
          canFire = true;
        } else if (ml > 0.01) desired = Math.atan2(my, mx);
      }
      if (desired !== null) {
        const diff = Core.angDiff(desired, this.aim), mr = cfg.turn * dt;
        this.aim = Core.wrapAngle(this.aim + Core.clamp(diff, -mr, mr));
        if (canFire && Math.abs(Core.angDiff(desired, this.aim)) < tol && (sp === 'flame' || Math.random() < cfg.fire)) k |= K.FIRE;
      }
      if (p.ammo < 1 && !sp && p.rapidT <= 0) k &= ~K.FIRE;

      // ---- 地雷（守旗的會在旗子附近埋）
      this.mineT -= dt;
      if (this.mineT <= 0) {
        this.mineT = 1;
        const guarding = mode === 'ctf' && room.obj && this.role === 'def' && Math.hypot(p.x - room.obj.flags[p.team].hx, p.y - room.obj.flags[p.team].hy) < 140;
        if (p.mineAmmo > 0 && tgt && d < 240 && Math.random() < cfg.mine * 4) k |= K.MINE;
        else if (p.mineAmmo >= (guarding ? 1 : 2) && Math.random() < cfg.mine * (guarding ? 3 : 1)) k |= K.MINE;
      }

      // ---- 呼叫空襲：附近有敵人就叫（沒看到敵人也有一點機率亂叫）
      if (p.air > 0) {
        this.airT -= dt;
        if (this.airT <= 0) {
          this.airT = 0.8 + Math.random() * 1.5;
          if (foes > 0 && ((tgt && d < 900) || Math.random() < 0.25)) k |= K.CALL;
        }
      }

      return { s: ++this.seq, k, a: this.aim, d: arty || this.brick ? Math.round(this.aimDist) : 0 };
    }

    nextWaypoint(map, p, goal, dt) {
      if (!goal) return null;
      const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
      const gx = Core.clamp(Math.floor(goal.x / TILE), 0, map.w - 1), gy = Core.clamp(Math.floor(goal.y / TILE), 0, map.h - 1);
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

  return { BotBrain, BOT_NAMES, LEVELS };
});
