/*
 * 房間 / 對戰邏輯（伺服器權威）。每個房間 60 tick/s 模擬，30 次/s 送快照給每位玩家。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core'), require('./maps'), require('./bot'));
  else root.TBGame = factory(root.Core, root.TBMaps, root.TBBot);
})(typeof self !== 'undefined' ? self : this, function (Core, TBMaps, TBBot) {
  'use strict';
  const { TILE, T, C, K } = Core;
  const { MAPS, parseMap } = TBMaps;
  const { BotBrain, BOT_NAMES } = TBBot;

  const COLORS = ['#ff4d4d', '#4da6ff', '#5cff6e', '#ffd84d', '#c77dff', '#ff9f43', '#00e5d4', '#ff6ec7'];
  const PU_WEIGHTS = { heal: 3, shield: 2, rapid: 2, triple: 2, rail: 1.4, mines: 1.6, speed: 1.6 };
  const PU_TEXT = { heal: '修復 +50', shield: '能量護盾', rapid: '狂暴連射', triple: '三連發', rail: '雷射砲 x3', mines: '地雷 +3', speed: '加速引擎' };
  const MAX_PLAYERS = 8;
  const TAUNTS = 5;

  let ids = 1;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function pickWeighted(w) {
    const keys = Object.keys(w);
    let total = 0;
    for (const k of keys) total += w[k];
    let r = Math.random() * total;
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return keys[0];
  }

  const MULTI = [null, null, ['雙殺！', 'DOUBLE KILL'], ['三殺！！', 'TRIPLE KILL'], ['四殺！！！', 'QUADRA KILL'], ['超神殺戮！！！', 'RAMPAGE']];
  const STREAK = { 3: ['大殺特殺', 'KILLING SPREE'], 5: ['勢不可擋', 'UNSTOPPABLE'], 7: ['無人能擋', 'DOMINATING'], 10: ['如神一般', 'GODLIKE'], 15: ['超越神了', 'BEYOND GODLIKE'] };

  class Room {
    constructor(code) {
      this.code = code;
      this.players = new Map();
      this.settings = { mode: 'ffa', target: 15, time: 300, map: -1 };
      this.mapIdx = Math.floor(Math.random() * MAPS.length);
      this.events = [];
      this.tickN = 0;
      this.time = 0;
      this.infoDirty = true;
      this.lastInfoAt = 0;
      this.emptySince = null;
      this.onBulletTile = this.onBulletTile.bind(this);
      this.startMatch();
    }

    // ------------------------------------------------------------ 玩家進出
    humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }

    addPlayer({ name, color, ws, level }) {
      if (this.players.size >= MAX_PLAYERS) {
        if (ws) {
          const bot = [...this.players.values()].find((p) => p.bot);
          if (!bot) return null;
          this.removePlayer(bot.id);
        } else return null;
      }
      const id = ids++;
      const p = {
        id, name, ws: ws || null, bot: level ? new BotBrain(level) : null,
        color: COLORS.includes(color) ? color : COLORS[id % COLORS.length],
        team: 0, kills: 0, deaths: 0, streak: 0, best: 0, multiN: 0, multiT: -99, lastKiller: null,
        inputQ: [], lastSeq: 0, held: 0, ack: 0, ta: 0, lastTaunt: -99,
        alive: false, respawnT: 0.6, mineAmmo: C.MINE_BASE,
      };
      if (this.settings.mode === 'team') p.team = this.smallerTeam();
      this.players.set(id, p);
      if (this.state === 'playing') this.spawn(p);
      this.infoDirty = true;
      this.sys(`${p.bot ? '🤖 ' : ''}${p.name} 加入了戰場`);
      return p;
    }

    removePlayer(id) {
      const p = this.players.get(id);
      if (!p) return;
      this.players.delete(id);
      this.mines = this.mines.filter((m) => m.owner !== id);
      this.infoDirty = true;
      this.sys(`${p.name} 離開了`);
    }

    smallerTeam() {
      const n = [0, 0];
      for (const p of this.players.values()) n[p.team]++;
      return n[0] <= n[1] ? 0 : 1;
    }

    addBot(level) {
      const used = new Set([...this.players.values()].map((p) => p.name));
      const pool = BOT_NAMES.filter((n) => !used.has(n));
      const name = pool.length ? pool[Math.floor(Math.random() * pool.length)] : `機器人${ids}`;
      const usedColors = new Set([...this.players.values()].map((p) => p.color));
      const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[ids % COLORS.length];
      return this.addPlayer({ name, color, level });
    }

    // ------------------------------------------------------------ 比賽流程
    startMatch() {
      if (this.settings.map >= 0 && this.settings.map < MAPS.length) this.mapIdx = this.settings.map;
      this.map = parseMap(MAPS[this.mapIdx]);
      this.bullets = []; this.mines = []; this.powerups = []; this.pending = []; this.barrelRespawn = [];
      this.state = 'playing';
      this.matchTime = this.settings.time;
      this.interT = 0;
      this.winner = null;
      this.puTimer = 4;
      this.firstBlood = false;
      this.matchPoint = false;
      for (const p of this.players.values()) {
        Object.assign(p, { kills: 0, deaths: 0, streak: 0, best: 0, multiN: 0, lastKiller: null, mineAmmo: C.MINE_BASE });
        p.alive = false;
        if (p.bot) p.bot.reset();
        this.spawn(p);
      }
      this.broadcastMap();
      this.infoDirty = true;
      this.event({ e: 'ann', t: this.map.name, s: 'FIGHT! 戰鬥開始', c: '#ffd84d', z: 'xl' });
    }

    endMatch() {
      if (this.state !== 'playing') return;
      this.state = 'intermission';
      this.interT = 10;
      const list = [...this.players.values()];
      if (this.settings.mode === 'team') {
        const s = this.teamScores();
        if (s[0] === s[1]) this.winner = { name: '平手', color: '#ffffff' };
        else this.winner = s[0] > s[1] ? { name: '紅隊', color: '#ff5252', team: 0 } : { name: '藍隊', color: '#448aff', team: 1 };
      } else {
        list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        if (!list.length || (list[1] && list[1].kills === list[0].kills && list[1].deaths === list[0].deaths)) this.winner = { name: '平手', color: '#ffffff' };
        else this.winner = { name: list[0].name, color: list[0].color, id: list[0].id };
      }
      this.bullets = [];
      this.event({ e: 'ann', t: this.winner.name === '平手' ? '平手！' : `🏆 ${this.winner.name} 獲勝！`, s: 'VICTORY', c: this.winner.color, z: 'xl' });
      this.event({ e: 'end' });
      this.infoDirty = true;
    }

    nextMap() {
      if (this.settings.map < 0) this.mapIdx = (this.mapIdx + 1) % MAPS.length;
      this.startMatch();
    }

    teamScores() {
      const s = [0, 0];
      for (const p of this.players.values()) s[p.team] += p.kills;
      return s;
    }

    // ------------------------------------------------------------ 出生
    pickSpawn(p) {
      let cands = this.map.spawns;
      if (this.settings.mode === 'team') {
        const half = (this.map.w * TILE) / 2;
        const side = cands.filter((s) => (p.team === 0 ? s.x < half : s.x >= half));
        if (side.length) cands = side;
      }
      const others = [...this.players.values()].filter((q) => q.alive && q !== p);
      const enemies = others.filter((q) => this.settings.mode !== 'team' || q.team !== p.team);
      let best = cands[0], bestScore = -Infinity;
      for (const s of cands) {
        let score = Math.random() * 60;
        let near = Infinity;
        for (const e of enemies) near = Math.min(near, dist(s, e));
        score += near === Infinity ? 1000 : near;
        for (const o of others) if (dist(s, o) < C.TANK_R * 2 + 6) score -= 5000;
        if (score > bestScore) { bestScore = score; best = s; }
      }
      return best;
    }

    spawn(p) {
      const s = this.pickSpawn(p);
      const cx = (this.map.w * TILE) / 2, cy = (this.map.h * TILE) / 2;
      const ha = Math.atan2(cy - s.y, cx - s.x);
      Object.assign(p, {
        alive: true, x: s.x, y: s.y, vx: 0, vy: 0, ha, ta: ha, hp: C.MAX_HP, shield: 0, shieldT: 0,
        dashT: 0, dashCd: 0, ammo: C.MAX_AMMO, ammoT: 0, fireCd: 0.3, mineAmmo: Math.max(p.mineAmmo || 0, C.MINE_BASE),
        mineT: 0, mineCd: 0.3, railAmmo: 0, rapidT: 0, tripleT: 0, boostT: 0, boost: false,
        protectT: C.PROTECT, revealT: 0, inBush: false, held: 0, lastHitBy: null, lastHitT: -99, justDashed: false,
      });
      this.event({ e: 'spawn', id: p.id, x: r1(p.x), y: r1(p.y) });
    }

    // ------------------------------------------------------------ 輸入
    input(p, list) {
      if (!Array.isArray(list)) return;
      for (const it of list.slice(0, 30)) {
        if (!Array.isArray(it)) continue;
        const [s, k, a] = it;
        if (typeof s !== 'number' || typeof k !== 'number' || typeof a !== 'number' || !isFinite(a)) continue;
        if (s <= p.lastSeq) continue;
        p.lastSeq = s;
        p.inputQ.push({ s, k: k & 127, a });
      }
      if (p.inputQ.length > 40) p.inputQ.splice(0, p.inputQ.length - 40);
    }

    processInputs(p, playing) {
      const q = p.inputQ;
      if (!q.length) return;
      let n = Math.min(q.length, 10);
      if (q.length > 20) n = q.length - 8;
      const can = playing && p.alive;
      let held = 0;
      for (let i = 0; i < n; i++) {
        const inp = q[i];
        if (can) {
          p.boost = p.boostT > 0;
          Core.stepTank(p, inp.k, C.DT, this.map);
          if (p.justDashed) {
            p.justDashed = false;
            this.event({ e: 'dash', id: p.id, x: r1(p.x), y: r1(p.y), a: r2(Math.atan2(p.vy, p.vx)) });
          }
        }
        held |= inp.k;
        p.ta = inp.a;
        p.ack = inp.s;
      }
      q.splice(0, n);
      p.held = held;
    }

    // ------------------------------------------------------------ 主迴圈
    tick() {
      const dt = C.DT;
      this.time += dt;
      this.tickN++;
      const playing = this.state === 'playing';

      for (const p of this.players.values()) {
        if (p.bot) {
          if (playing && p.alive) p.inputQ.push(p.bot.think(this, p, dt));
          else p.inputQ.length = 0;
        }
        this.processInputs(p, playing);
      }

      if (playing) {
        this.tankCollisions();
        for (const p of this.players.values()) this.updatePlayer(p, dt);
        this.updateBullets(dt);
        this.updateMines(dt);
        this.updatePending(dt);
        this.updateBarrels(dt);
        this.updatePowerups(dt);
        this.matchTime -= dt;
        if (this.matchTime <= 0) this.endMatch();
      } else {
        this.interT -= dt;
        if (this.interT <= 0) this.nextMap();
      }

      if (this.tickN % 2 === 0) this.broadcast();
      const now = performance.now();
      if (this.infoDirty ? now - this.lastInfoAt > 200 : now - this.lastInfoAt > 1000) this.broadcastInfo();
    }

    updatePlayer(p, dt) {
      if (!p.alive) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.spawn(p);
        return;
      }
      p.fireCd -= dt; p.mineCd -= dt;
      if (p.protectT > 0) p.protectT -= dt;
      if (p.revealT > 0) p.revealT -= dt;
      if (p.rapidT > 0) p.rapidT -= dt;
      if (p.tripleT > 0) p.tripleT -= dt;
      if (p.boostT > 0) p.boostT -= dt;
      if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) p.shield = 0; }
      if (p.ammo < C.MAX_AMMO) {
        p.ammoT += dt;
        if (p.ammoT >= C.AMMO_REGEN) { p.ammo++; p.ammoT = 0; }
      } else p.ammoT = 0;
      if (p.mineAmmo < C.MINE_BASE) {
        p.mineT += dt;
        if (p.mineT >= C.MINE_REGEN) { p.mineAmmo++; p.mineT = 0; }
      } else p.mineT = 0;

      if ((p.held & K.FIRE) && p.fireCd <= 0) this.fire(p);
      if ((p.held & K.MINE) && p.mineCd <= 0) this.placeMine(p);

      p.inBush = Core.tileAt(this.map, Math.floor(p.x / TILE), Math.floor(p.y / TILE)) === T.BUSH;

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const u = this.powerups[i];
        if (dist(u, p) < C.TANK_R + 16) {
          this.powerups.splice(i, 1);
          this.applyPowerup(p, u.k);
          this.event({ e: 'pu', id: p.id, k: u.k, x: u.x, y: u.y, t: PU_TEXT[u.k] });
        }
      }
    }

    tankCollisions() {
      const arr = [...this.players.values()].filter((p) => p.alive);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = C.TANK_R * 2;
          if (d < min) {
            const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
            const push = (min - d) / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
            Core.resolveTank(this.map, a);
            Core.resolveTank(this.map, b);
          }
        }
      }
    }

    // ------------------------------------------------------------ 武器
    fire(p) {
      const a = p.ta;
      p.protectT = 0;
      p.revealT = 0.9;
      if (p.railAmmo > 0) {
        p.railAmmo--;
        p.fireCd = C.RAIL_CD;
        this.fireRail(p, a);
        return;
      }
      const rapid = p.rapidT > 0;
      if (!rapid) {
        if (p.ammo < 1) { p.fireCd = 0.25; this.event({ e: 'dry', to: p.id }); return; }
        p.ammo--;
      }
      p.fireCd = rapid ? C.RAPID_CD : C.FIRE_CD;
      const spread = p.tripleT > 0 ? [-0.17, 0, 0.17] : [0];
      for (const s of spread) this.spawnBullet(p, a + s + (rapid ? (Math.random() - 0.5) * 0.07 : 0), rapid);
      this.event({ e: 'shot', id: p.id, x: r1(p.x + Math.cos(a) * 24), y: r1(p.y + Math.sin(a) * 24), a: r2(a), k: rapid ? 1 : 0 });
    }

    spawnBullet(p, a, rapid) {
      const sp = C.BULLET_SPEED * (rapid ? 1.1 : 1);
      const b = {
        id: ids++, owner: p.id, team: p.team, x: p.x, y: p.y, px: p.x, py: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, bounces: 0, maxB: C.BULLET_BOUNCES,
        life: C.BULLET_LIFE, dmg: rapid ? C.RAPID_DMG : C.BULLET_DMG, kind: rapid ? 1 : 0, sx: p.x, sy: p.y,
      };
      if (Core.stepBullet(this.map, b, 20 / sp, this.onBulletTile)) this.bullets.push(b);
    }

    onBulletTile(b, tx, ty, tt, hx, hy) {
      if (tt === T.STEEL) {
        if (b.bounces < b.maxB) {
          b.bounces++;
          this.event({ e: 'bnc', x: r1(hx), y: r1(hy) });
          return true;
        }
        this.event({ e: 'spark', x: r1(hx), y: r1(hy) });
        return false;
      }
      if (tt === T.BRICK) { this.damageBrick(tx, ty, 1); this.event({ e: 'spark', x: r1(hx), y: r1(hy), b: 1 }); return false; }
      if (tt === T.BARREL) { this.explodeBarrel(tx, ty, b.owner); return false; }
      return false;
    }

    fireRail(p, a) {
      const res = Core.castRay(this.map, p.x, p.y, a, C.RAIL_LEN, C.RAIL_BOUNCES, true);
      this.event({ e: 'rail', id: p.id, pts: res.pts.map(([x, y]) => [r1(x), r1(y)]) });
      const hit = new Set();
      const mode = this.settings.mode;
      for (let s = 0; s < res.pts.length - 1; s++) {
        const [x0, y0] = res.pts[s], [x1, y1] = res.pts[s + 1];
        for (const q of this.players.values()) {
          if (!q.alive || hit.has(q)) continue;
          if (q === p && s === 0) continue;
          if (mode === 'team' && q.team === p.team && q !== p) continue;
          if (Core.segPointDist(x0, y0, x1, y1, q.x, q.y) < C.TANK_R + 5) {
            hit.add(q);
            this.damage(q, C.RAIL_DMG, p.id, 'rail', { bounce: s > 0, rail: true, from: p });
          }
        }
        for (const m of this.mines) {
          if (!m.dead && Core.segPointDist(x0, y0, x1, y1, m.x, m.y) < 12) {
            m.dead = true;
            this.pending.push({ t: 0.05, type: 'mine', m, by: p.id });
          }
        }
      }
      for (const h of res.hits) {
        if (h.t === T.BRICK) this.damageBrick(h.tx, h.ty, 99);
        else if (h.t === T.BARREL) this.pending.push({ t: 0.06, type: 'barrel', tx: h.tx, ty: h.ty, owner: p.id });
      }
    }

    placeMine(p) {
      if (p.mineAmmo <= 0) { p.mineCd = 0.4; this.event({ e: 'dry', to: p.id, m: 1 }); return; }
      for (const m of this.mines) if (Math.hypot(m.x - p.x, m.y - p.y) < 22) { p.mineCd = 0.2; return; }
      const mine = this.mines.filter((m) => m.owner === p.id);
      if (mine.length >= C.MINE_MAX_ACTIVE) {
        const old = mine[0];
        this.mines = this.mines.filter((m) => m !== old);
        this.event({ e: 'fizzle', x: r1(old.x), y: r1(old.y) });
      }
      p.mineAmmo--;
      p.mineCd = 0.5;
      p.protectT = 0;
      this.mines.push({ id: ids++, owner: p.id, team: p.team, x: p.x, y: p.y, arm: C.MINE_ARM });
      this.event({ e: 'mine', x: r1(p.x), y: r1(p.y), id: p.id });
    }

    updateMines(dt) {
      const team = this.settings.mode === 'team';
      for (const m of this.mines) {
        if (m.dead) continue;
        if (m.arm > 0) {
          m.arm -= dt;
          if (m.arm <= 0) this.event({ e: 'armed', to: m.owner, x: r1(m.x), y: r1(m.y) });
          continue;
        }
        for (const q of this.players.values()) {
          if (!q.alive || q.id === m.owner || q.protectT > 0) continue;
          if (team && q.team === m.team) continue;
          if (Math.hypot(q.x - m.x, q.y - m.y) < C.MINE_TRIGGER + C.TANK_R * 0.5) {
            this.detonateMine(m, m.owner);
            break;
          }
        }
      }
      this.mines = this.mines.filter((m) => !m.dead);
    }

    detonateMine(m, by) {
      m.dead = true;
      this.explode(m.x, m.y, C.MINE_RADIUS, C.MINE_DMG, by, 'mine');
    }

    updateBullets(dt) {
      const team = this.settings.mode === 'team';
      for (const b of this.bullets) {
        b.px = b.x; b.py = b.y;
        const alive = Core.stepBullet(this.map, b, dt, this.onBulletTile);
        b.life -= dt;
        if (!alive) b.dead = true;
        else if (b.life <= 0) { b.dead = true; this.event({ e: 'fizzle', x: r1(b.x), y: r1(b.y), s: 1 }); }
      }
      for (const b of this.bullets) {
        if (b.dead) continue;
        for (const q of this.players.values()) {
          if (!q.alive) continue;
          if (q.id === b.owner && b.bounces === 0) continue;
          if (team && q.team === b.team && q.id !== b.owner) continue;
          if (Core.segPointDist(b.px, b.py, b.x, b.y, q.x, q.y) < C.TANK_R + 3) {
            b.dead = true;
            const owner = this.players.get(b.owner);
            this.damage(q, b.dmg, b.owner, 'shell', { bounce: b.bounces > 0, from: owner, sx: b.sx, sy: b.sy });
            break;
          }
        }
        if (b.dead) continue;
        for (const m of this.mines) {
          if (m.dead) continue;
          if (Core.segPointDist(b.px, b.py, b.x, b.y, m.x, m.y) < 10) {
            b.dead = true;
            this.detonateMine(m, b.owner);
            break;
          }
        }
      }
      // 砲彈互撞抵銷
      const bs = this.bullets;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (a.dead) continue;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (b.dead) continue;
          const dx0 = a.px - b.px, dy0 = a.py - b.py;
          const ddx = (a.x - a.px) - (b.x - b.px), ddy = (a.y - a.py) - (b.y - b.py);
          const l2 = ddx * ddx + ddy * ddy;
          let t = l2 > 0 ? -(dx0 * ddx + dy0 * ddy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = dx0 + ddx * t, cy = dy0 + ddy * t;
          if (cx * cx + cy * cy < 64) {
            a.dead = b.dead = true;
            this.event({ e: 'clash', x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2) });
            break;
          }
        }
      }
      this.bullets = bs.filter((b) => !b.dead);
      this.mines = this.mines.filter((m) => !m.dead);
    }

    // ------------------------------------------------------------ 爆炸與傷害
    damageBrick(tx, ty, amount) {
      const i = ty * this.map.w + tx;
      if (this.map.tiles[i] !== T.BRICK) return;
      const hp = this.map.hp[i] - amount;
      if (hp <= 0) {
        this.map.tiles[i] = T.FLOOR;
        this.map.hp[i] = 0;
        this.event({ e: 'tile', i, v: T.FLOOR, d: 1 });
      } else {
        this.map.hp[i] = hp;
        this.event({ e: 'tile', i, v: T.BRICK, hp });
      }
    }

    explodeBarrel(tx, ty, owner) {
      const i = ty * this.map.w + tx;
      if (this.map.tiles[i] !== T.BARREL) return;
      this.map.tiles[i] = T.FLOOR;
      this.event({ e: 'tile', i, v: T.FLOOR, d: 2 });
      this.barrelRespawn.push({ i, t: C.BARREL_RESPAWN });
      this.explode(tx * TILE + TILE / 2, ty * TILE + TILE / 2, C.BARREL_RADIUS, C.BARREL_DMG, owner, 'barrel');
    }

    explode(x, y, radius, dmg, ownerId, weapon) {
      this.event({ e: 'boom', x: r1(x), y: r1(y), r: radius, k: weapon });
      const owner = this.players.get(ownerId);
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        const reach = radius + C.TANK_R * 0.5;
        if (d >= reach) continue;
        const f = 1 - d / reach;
        let dm = dmg * (0.35 + 0.65 * f);
        if (p.id === ownerId) dm *= 0.5;
        const nx = d > 0.1 ? (p.x - x) / d : Math.cos(p.ha), ny = d > 0.1 ? (p.y - y) / d : Math.sin(p.ha);
        const imp = 120 + 480 * f;
        p.vx += nx * imp; p.vy += ny * imp;
        this.damage(p, dm, ownerId, weapon, { from: owner });
      }
      const { w, h, tiles } = this.map;
      const r = radius * 0.8;
      const x0 = Math.max(0, Math.floor((x - r) / TILE)), x1 = Math.min(w - 1, Math.floor((x + r) / TILE));
      const y0 = Math.max(0, Math.floor((y - r) / TILE)), y1 = Math.min(h - 1, Math.floor((y + r) / TILE));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
          const d = Math.hypot(cx - x, cy - y);
          const t = tiles[ty * w + tx];
          if (t === T.BRICK && d < r) this.damageBrick(tx, ty, d < r * 0.6 ? 99 : 2);
          else if (t === T.BARREL && d < radius * 0.9 && d > 1) this.pending.push({ t: 0.12 + Math.random() * 0.06, type: 'barrel', tx, ty, owner: ownerId });
        }
      }
      for (const m of this.mines) {
        if (m.dead) continue;
        if (Math.hypot(m.x - x, m.y - y) < radius * 0.9) {
          m.dead = true;
          this.pending.push({ t: 0.1 + Math.random() * 0.05, type: 'mine', m, by: ownerId });
        }
      }
    }

    updatePending(dt) {
      if (!this.pending.length) return;
      const due = [];
      this.pending = this.pending.filter((it) => { it.t -= dt; if (it.t <= 0) { due.push(it); return false; } return true; });
      for (const it of due) {
        if (it.type === 'barrel') this.explodeBarrel(it.tx, it.ty, it.owner);
        else if (it.type === 'mine') this.explode(it.m.x, it.m.y, C.MINE_RADIUS, C.MINE_DMG, it.by, 'mine');
        else if (it.type === 'tankboom') this.explode(it.x, it.y, 70, 22, it.owner, 'boom');
      }
    }

    damage(victim, dmg, attackerId, weapon, extra) {
      if (!victim.alive || victim.protectT > 0 || this.state !== 'playing') return;
      const att = this.players.get(attackerId);
      if (this.settings.mode === 'team' && att && att !== victim && att.team === victim.team) return;
      let absorbed = 0;
      if (victim.shield > 0) {
        absorbed = Math.min(victim.shield, dmg);
        victim.shield -= absorbed;
        dmg -= absorbed;
      }
      victim.hp -= dmg;
      this.event({ e: 'hit', id: victim.id, by: attackerId, d: Math.round(dmg + absorbed), s: absorbed > 0 ? 1 : 0, x: r1(victim.x), y: r1(victim.y) });
      if (att && att !== victim) { victim.lastHitBy = att.id; victim.lastHitT = this.time; }
      if (victim.hp <= 0.5) this.kill(victim, att, weapon, extra || {});
    }

    ann(t, s, c, z, to) { this.event({ e: 'ann', t, s, c: c || '#ffffff', z: z || 'l', to }); }

    kill(victim, killer, weapon, extra) {
      victim.alive = false;
      victim.hp = 0;
      victim.respawnT = C.RESPAWN;
      victim.deaths++;
      let k = killer;
      let forced = false;
      if ((!k || k === victim) && victim.lastHitBy && this.time - victim.lastHitT < 4) {
        const k2 = this.players.get(victim.lastHitBy);
        if (k2) { k = k2; forced = true; }
      }
      const vStreak = victim.streak;
      victim.streak = 0;
      const ev = { e: 'kill', k: k ? k.id : victim.id, v: victim.id, w: weapon, x: r1(victim.x), y: r1(victim.y) };

      if (k && k !== victim) {
        k.kills++;
        k.streak++;
        k.best = Math.max(k.best, k.streak);
        k.multiN = this.time - k.multiT < 4 ? k.multiN + 1 : 1;
        k.multiT = this.time;
        const bounce = extra.bounce && !forced;
        if (bounce) ev.b = 1;
        if (forced) ev.f = 1;

        if (!this.firstBlood) { this.firstBlood = true; this.ann(`${k.name} 拿下首殺！`, 'FIRST BLOOD', '#ff5252', 'l'); }
        const mm = MULTI[Math.min(k.multiN, 5)];
        if (mm) this.ann(`${k.name}　${mm[0]}`, mm[1], '#ffb142', 'xl');
        if (STREAK[k.streak]) this.ann(`${k.name} ${STREAK[k.streak][0]}！`, STREAK[k.streak][1], '#c77dff', 'l');
        if (vStreak >= 3) this.ann(`${k.name} 終結了 ${victim.name} 的 ${vStreak} 連殺！`, 'SHUTDOWN', '#00e5d4', 'l');

        if (k.lastKiller === victim.id) { this.ann('復仇成功！', 'REVENGE', '#ff6ec7', 'm', k.id); k.lastKiller = null; }
        if (bounce) this.ann(extra.rail ? '雷射折射擊殺！' : '神之反彈！', 'RICOCHET', '#5cff6e', 'm', k.id);
        if (forced) this.ann('逼他自爆！', 'DENIED', '#5cff6e', 'm', k.id);
        if (!forced && weapon === 'shell' && extra.sx !== undefined && Math.hypot(extra.sx - victim.x, extra.sy - victim.y) > 650) this.ann('遠程狙殺！', 'LONG SHOT', '#4da6ff', 'm', k.id);
        if (weapon === 'mine' && extra.from === k) this.ann('地雷大師！', 'BOOM!', '#ff9f43', 'm', k.id);
        victim.lastKiller = k.id;

        if (this.settings.mode === 'team') {
          const s = this.teamScores();
          if (s[k.team] >= this.settings.target) this.endMatch();
          else if (!this.matchPoint && s[k.team] === this.settings.target - 1) { this.matchPoint = true; this.ann(`${k.team ? '藍隊' : '紅隊'} 賽點！`, 'MATCH POINT', k.team ? '#448aff' : '#ff5252', 'l'); }
        } else if (k.kills >= this.settings.target) this.endMatch();
        else if (k.kills === this.settings.target - 1) this.ann(`${k.name} 賽點！`, 'MATCH POINT', '#ffd84d', 'l');
      } else {
        victim.kills--;
        ev.self = 1;
        this.ann(weapon === 'mine' ? '被自己的地雷炸飛 🤡' : weapon === 'shell' ? '被自己的砲彈打爆 🤡' : '把自己炸上天了 🤡', 'SELF DESTRUCT', '#aaaaaa', 'm', victim.id);
      }
      this.event(ev);
      this.pending.push({ t: 0.05, type: 'tankboom', x: victim.x, y: victim.y, owner: k ? k.id : victim.id });
      this.infoDirty = true;
    }

    applyPowerup(p, k) {
      switch (k) {
        case 'heal': p.hp = Math.min(C.MAX_HP, p.hp + 50); break;
        case 'shield': p.shield = 60; p.shieldT = 12; break;
        case 'rapid': p.rapidT = 7; break;
        case 'triple': p.tripleT = 10; break;
        case 'rail': p.railAmmo = 3; break;
        case 'mines': p.mineAmmo = Math.min(C.MINE_CAP, p.mineAmmo + 3); break;
        case 'speed': p.boostT = 8; break;
      }
    }

    updatePowerups(dt) {
      this.puTimer -= dt;
      if (this.puTimer > 0) return;
      this.puTimer = 7 + Math.random() * 4;
      const free = this.map.powerSpots.filter((s) => !this.powerups.some((u) => u.x === s.x && u.y === s.y));
      if (!free.length) return;
      const s = free[Math.floor(Math.random() * free.length)];
      const u = { id: ids++, x: s.x, y: s.y, k: pickWeighted(PU_WEIGHTS) };
      this.powerups.push(u);
      this.event({ e: 'puspawn', x: s.x, y: s.y, k: u.k });
    }

    updateBarrels(dt) {
      for (const b of this.barrelRespawn) {
        b.t -= dt;
        if (b.t > 0) continue;
        const cx = (b.i % this.map.w) * TILE + TILE / 2, cy = Math.floor(b.i / this.map.w) * TILE + TILE / 2;
        let blocked = false;
        for (const p of this.players.values()) if (p.alive && Math.abs(p.x - cx) < TILE / 2 + C.TANK_R + 2 && Math.abs(p.y - cy) < TILE / 2 + C.TANK_R + 2) blocked = true;
        for (const m of this.mines) if (Math.hypot(m.x - cx, m.y - cy) < 30) blocked = true;
        if (blocked) { b.t = 1; continue; }
        b.done = true;
        this.map.tiles[b.i] = T.BARREL;
        this.event({ e: 'tile', i: b.i, v: T.BARREL });
      }
      this.barrelRespawn = this.barrelRespawn.filter((b) => !b.done);
    }

    // ------------------------------------------------------------ 指令
    command(p, msg) {
      const v = msg.v;
      const s = this.settings;
      switch (msg.c) {
        case 'mode':
          if (v !== 'ffa' && v !== 'team') return;
          s.mode = v;
          if (v === 'team') {
            const list = [...this.players.values()];
            const humans = list.filter((q) => !q.bot), bots = list.filter((q) => q.bot);
            humans.forEach((q, i) => (q.team = i % 2));
            bots.forEach((q) => (q.team = this.countTeam(0, q) <= this.countTeam(1, q) ? 0 : 1));
          }
          this.sys(`${p.name} 把模式改成「${v === 'team' ? '團隊戰' : '個人混戰'}」`);
          this.startMatch();
          break;
        case 'target':
          if (![5, 10, 15, 20, 30, 50].includes(v)) return;
          s.target = v;
          this.sys(`${p.name} 把勝利條件改成 ${v} 殺`);
          break;
        case 'time':
          if (![120, 180, 300, 480, 600, 900].includes(v)) return;
          this.matchTime += v - s.time;
          s.time = v;
          this.sys(`${p.name} 把時間限制改成 ${v / 60} 分鐘`);
          break;
        case 'map':
          if (typeof v !== 'number' || v < -1 || v >= MAPS.length) return;
          s.map = v;
          this.sys(`${p.name} 選擇了地圖「${v < 0 ? '輪替' : MAPS[v].name}」`);
          if (v >= 0) this.startMatch();
          break;
        case 'restart':
          this.sys(`${p.name} 重新開始了比賽`);
          this.startMatch();
          break;
        case 'addbot': {
          if (!['easy', 'normal', 'hard'].includes(v)) return;
          if (this.players.size >= MAX_PLAYERS) return this.sys('房間已滿（最多 8 台坦克）');
          const b = this.addBot(v);
          if (b && s.mode === 'team') b.team = this.countTeam(0, b) <= this.countTeam(1, b) ? 0 : 1;
          break;
        }
        case 'rmbot': {
          const bots = [...this.players.values()].filter((q) => q.bot);
          if (bots.length) this.removePlayer(bots[bots.length - 1].id);
          break;
        }
        case 'team':
          if (s.mode !== 'team') return;
          p.team = 1 - p.team;
          if (p.alive) { p.alive = false; p.respawnT = 1; this.mines = this.mines.filter((m) => m.owner !== p.id); }
          this.sys(`${p.name} 換到了${p.team ? '藍隊' : '紅隊'}`);
          break;
        default:
          return;
      }
      this.infoDirty = true;
    }

    countTeam(t, except) {
      let n = 0;
      for (const q of this.players.values()) if (q !== except && q.team === t) n++;
      return n;
    }

    taunt(p, i) {
      if (typeof i !== 'number' || i < 0 || i >= TAUNTS || this.time - p.lastTaunt < 1) return;
      p.lastTaunt = this.time;
      this.event({ e: 'taunt', id: p.id, i });
    }

    // ------------------------------------------------------------ 網路
    event(ev) { this.events.push(ev); }
    sys(text) { this.event({ e: 'sys', t: text }); }

    send(p, obj) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    }

    mapMsg() {
      return JSON.stringify({ t: 'map', name: this.map.name, w: this.map.w, h: this.map.h, tiles: Core.encodeTiles(this.map.tiles), hp: Core.encodeTiles(this.map.hp) });
    }

    broadcastMap() {
      const msg = this.mapMsg();
      for (const p of this.players.values()) this.send(p, msg);
    }

    infoMsg() {
      return {
        t: 'info', code: this.code, state: this.state, settings: this.settings, mapName: this.map.name,
        maps: MAPS.map((m) => m.name), timeLeft: Math.max(0, Math.ceil(this.matchTime)), interT: Math.ceil(this.interT),
        winner: this.winner, teams: this.teamScores(),
        players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team, k: p.kills, d: p.deaths, st: p.streak, b: p.best, bot: p.bot ? p.bot.level : null })),
      };
    }

    broadcastInfo() {
      this.infoDirty = false;
      this.lastInfoAt = performance.now();
      const msg = JSON.stringify(this.infoMsg());
      for (const p of this.players.values()) this.send(p, msg);
    }

    canSee(viewer, p) {
      if (p === viewer) return true;
      if (this.settings.mode === 'team' && p.team === viewer.team) return true;
      if (!p.inBush || p.revealT > 0) return true;
      return viewer.alive && dist(viewer, p) < C.BUSH_SEE;
    }

    canSeeMine(viewer, m) {
      if (m.owner === viewer.id || m.arm > 0) return true;
      if (this.settings.mode === 'team' && m.team === viewer.team) return true;
      return viewer.alive && dist(viewer, m) < C.MINE_SEE;
    }

    broadcast() {
      const tm = Math.round(performance.now());
      const tanks = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const flags = (p.protectT > 0 ? 1 : 0) | (p.shield > 0 ? 2 : 0) | (p.boostT > 0 ? 4 : 0) | (p.rapidT > 0 ? 8 : 0) |
          (p.tripleT > 0 ? 16 : 0) | (p.railAmmo > 0 ? 32 : 0) | (p.inBush ? 64 : 0) | (p.dashT > 0 ? 128 : 0);
        tanks.push({ p, a: [p.id, r1(p.x), r1(p.y), r2(p.ha), r2(p.ta), Math.ceil(p.hp), flags, Math.ceil(p.shield)] });
      }
      const B = this.bullets.map((b) => [b.id, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.bounces, b.maxB, b.kind, b.owner]);
      const P = this.powerups.map((u) => [u.id, u.x, u.y, u.k]);
      const events = this.events;
      this.events = [];
      for (const v of this.players.values()) {
        if (!v.ws || v.ws.readyState !== 1) continue;
        if (v.ws.bufferedAmount > 512 * 1024) continue;
        const T_ = [];
        for (const t of tanks) if (this.canSee(v, t.p)) T_.push(t.a);
        const M = [];
        for (const m of this.mines) if (this.canSeeMine(v, m)) M.push([m.id, r1(m.x), r1(m.y), m.arm > 0 ? 0 : 1, m.owner]);
        const E = events.filter((e) => e.to === undefined || e.to === v.id);
        const you = {
          alive: v.alive, x: v.x, y: v.y, vx: v.vx, vy: v.vy, ha: v.ha, dashT: v.dashT, dashCd: v.dashCd, ack: v.ack,
          hp: Math.ceil(v.hp), shield: Math.ceil(v.shield || 0), ammo: v.ammo, ammoT: r2(v.ammoT / C.AMMO_REGEN), mines: v.mineAmmo,
          rail: v.railAmmo, rapidT: r1(v.rapidT), tripleT: r1(v.tripleT), boostT: r1(v.boostT), shieldT: r1(v.shieldT),
          protectT: r1(v.protectT), respawnT: r1(v.respawnT), team: v.team,
        };
        v.ws.send(JSON.stringify({ t: 's', tm, T: T_, B, M, P, E, you }));
      }
    }
  }

  const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

  // 一條連線（WebSocket 或 WebRTC）對應一個玩家；伺服器與瀏覽器房主共用
  // sock: { send(str), readyState, bufferedAmount }；getRoom(code) 回傳要加入的房間
  function createClient(sock, getRoom, welcomeExtra) {
    let room = null, player = null, pingAt = 0;
    return {
      message(data) {
        let msg = data;
        if (typeof data === 'string') { try { msg = JSON.parse(data); } catch (e) { return; } }
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'join' && !player) {
          const code = clean(msg.room, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TANK';
          room = getRoom(code);
          player = room.addPlayer({ name: clean(msg.name, 12) || '無名坦克', color: msg.color, ws: sock });
          if (!player) { sock.send(JSON.stringify({ t: 'full' })); room = null; return; }
          room.emptySince = null;
          sock.send(JSON.stringify(Object.assign({ t: 'welcome', id: player.id, room: room.code }, welcomeExtra ? welcomeExtra() : {})));
          sock.send(room.mapMsg());
          sock.send(JSON.stringify(room.infoMsg()));
          return;
        }
        if (!player || !room.players.has(player.id)) return;
        switch (msg.t) {
          case 'i': room.input(player, msg.l); break;
          case 'cmd': room.command(player, msg); break;
          case 'taunt': room.taunt(player, msg.i); break;
          case 'p': {
            const now = Date.now();
            if (now - pingAt > 500) { pingAt = now; sock.send(JSON.stringify({ t: 'P', c: msg.c })); }
            break;
          }
        }
      },
      close() {
        if (room && player) room.removePlayer(player.id);
        room = player = null;
      },
    };
  }

  return { Room, COLORS, MAX_PLAYERS, createClient };
});
