/*
 * 房間 / 對戰邏輯（伺服器權威）。每個房間 60 tick/s 模擬，30 次/s 送快照給每位玩家。
 * 模式：個人混戰、紅藍團隊戰、搶旗大戰、山丘之王、縮圈大逃殺、生存闖關
 * 房間狀態：waiting（等待室，等人到齊）→ playing（比賽中）→ intermission（結算）→ playing（下一場）…
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core'), require('./maps'), require('./bot'));
  else root.TBGame = factory(root.Core, root.TBMaps, root.TBBot);
})(typeof self !== 'undefined' ? self : this, function (Core, TBMaps, TBBot) {
  'use strict';
  const { TILE, T, C, K, CLASSES, CLASS_LIST } = Core;
  const { MAPS, parseMap } = TBMaps;
  const { BotBrain, BOT_NAMES } = TBBot;

  const COLORS = ['#ff4d4d', '#4da6ff', '#5cff6e', '#ffd84d', '#c77dff', '#ff9f43', '#00e5d4', '#ff6ec7'];
  const SKINS = ['classic', 'camo', 'stripe', 'bolt', 'skull', 'neon', 'gold', 'rainbow'];
  const TEAM_NAMES = ['紅隊', '藍隊'];
  const TEAM_COLORS = ['#ff5252', '#448aff'];
  const LEVELS = ['easy', 'normal', 'hard'];
  const TIMES = [120, 180, 300, 480, 600, 900];

  // team：分紅藍隊（隊友沒有傷害）；tc：用隊伍顏色畫坦克；targets：勝利條件選項（0 = 無盡）
  const MODES = {
    ffa: { name: '個人混戰', icon: '⚔️', team: false, tc: false, targets: [5, 10, 15, 20, 30, 50], def: 15, unit: '殺', desc: '先達到目標擊殺數的人獲勝' },
    team: { name: '紅藍團隊戰', icon: '🤝', team: true, tc: true, targets: [5, 10, 15, 20, 30, 50], def: 15, unit: '殺', desc: '自動分成兩隊，比全隊的總擊殺數' },
    ctf: { name: '搶旗大戰', icon: '🚩', team: true, tc: true, targets: [1, 2, 3, 5, 7], def: 3, unit: '分', desc: '把敵人的旗子搶回自己的旗座就得分（自己的旗子要在家）' },
    koth: { name: '山丘之王', icon: '⛰️', team: false, tc: false, targets: [30, 45, 60, 90, 120], def: 60, unit: '秒', desc: '一個人獨佔發光的山頭就會累積秒數，山頭每 40 秒換位置' },
    br: { name: '縮圈大逃殺', icon: '🐔', team: false, tc: false, targets: [1, 2, 3, 5, 7], def: 3, unit: '勝', desc: '每回合只有一條命，毒圈越縮越小，活到最後贏一回合' },
    waves: { name: '生存闖關', icon: '🧟', team: true, tc: false, coop: true, targets: [5, 10, 15, 20, 0], def: 10, unit: '波', desc: '大家同一隊，擋住一波比一波強的敵軍和 BOSS，生命用完就輸' },
  };

  const PU_WEIGHTS = { heal: 3, shield: 2, rapid: 1.5, triple: 1.5, rail: 1.1, mines: 1.2, speed: 1.4, homing: 1.2, shotgun: 1.3, flame: 1.1, cloak: 1, bounce: 1.3 };
  const PU_TEXT = {
    heal: '修復 +50', shield: '能量護盾', rapid: '狂暴連射', triple: '三連發', rail: '雷射砲 x3', mines: '地雷 +3', speed: '加速引擎',
    homing: '追蹤飛彈 x3', shotgun: '霰彈砲 x4', flame: '火焰噴射', cloak: '隱形迷彩', bounce: '超級反彈',
    supply: '補給包', crate: '空投補給',
  };
  const SPECIAL = { rail: 3, homing: 3, shotgun: 4, flame: C.FLAME_FUEL };
  const BOT_CLASS_W = { medium: 3, heavy: 2, light: 2, td: 1.5, spg: 1.5 };
  const HOST_ONLY = { mode: 1, target: 1, time: 1, map: 1, restart: 1, addbot: 1, rmbot: 1, start: 1, lobby: 1, players: 1, bots: 1, level: 1 };
  const MAX_PLAYERS = 8;
  const MAX_ENEMIES = 9;
  const TAUNTS = 5;

  // 大逃殺毒圈：每一階段先等 wait 秒，再花 shrink 秒縮到半徑 r；圈外每秒扣 dps
  const BR_STAGES = [
    { wait: 12, shrink: 20, r: 470, dps: 6, f: 0.4 },
    { wait: 9, shrink: 16, r: 270, dps: 10, f: 0.75 },
    { wait: 7, shrink: 14, r: 120, dps: 16, f: 1 },
    { wait: 5, shrink: 14, r: 0, dps: 25, f: 1 },
  ];
  // 闖關的敵軍：坦克種類決定名字和外型，等級決定 AI 強度
  const ENEMY = {
    light: { name: '雜兵', color: '#9aa3ad' },
    medium: { name: '突擊兵', color: '#c9b458' },
    heavy: { name: '重裝兵', color: '#e0534a' },
    spg: { name: '砲兵', color: '#d9884a' },
    td: { name: '狙擊兵', color: '#5fa8a0' },
    boss: { name: '重裝魔王', color: '#9b5de5' },
  };

  let ids = 1;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const newStats = () => ({ shots: 0, hits: 0, dmg: 0, rico: 0, mineK: 0, barrelK: 0, flameK: 0, missileK: 0, railK: 0, airK: 0, artyK: 0, caps: 0, rets: 0, hill: 0, bossK: 0, crates: 0 });

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
      // players：要等幾個真人到齊才開始；bots：電腦玩家數量；level：電腦難度
      this.settings = { mode: 'ffa', target: 15, time: 300, map: -1, players: 2, bots: 0, level: 'normal' };
      this.mapIdx = Math.floor(Math.random() * MAPS.length);
      this.events = [];
      this.tickN = 0;
      this.time = 0;
      this.infoDirty = true;
      this.lastInfoAt = 0;
      this.emptySince = null;
      this.hostId = 0;
      this.joinCount = 0;
      this.onBulletTile = this.onBulletTile.bind(this);
      this.enterWaiting();
    }

    get M() { return MODES[this.settings.mode] || MODES.ffa; }
    isTeam() { return this.M.team; }

    // ------------------------------------------------------------ 玩家進出
    humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
    squad() { let n = 0; for (const p of this.players.values()) if (!p.enemy) n++; return n; }
    allyBots() { return [...this.players.values()].filter((q) => q.bot && !q.enemy); }

    newPlayer(f) {
      return Object.assign({
        id: ids++, name: '', ws: null, bot: null, color: COLORS[0], skin: 'classic', cls: 'medium', nextCls: null,
        team: 0, kills: 0, deaths: 0, streak: 0, best: 0, multiN: 0, multiT: -99, lastKiller: null,
        score: 0, st: newStats(), enemy: false, boss: false, r: C.TANK_R, maxHp: C.MAX_HP, spd: 1,
        dcd: C.DASH_CD, maxAmmo: C.MAX_AMMO, regen: C.AMMO_REGEN, fcd0: C.FIRE_CD, dmg: C.BULLET_DMG, bspd: C.BULLET_SPEED,
        kb: 1, see: C.BUSH_SEE, mineSee: C.MINE_SEE, air: 0, airCd: 0, tdist: 300,
        inputQ: [], lastSeq: 0, held: 0, ack: 0, ta: 0, lastTaunt: -99, shotN: 0, lastCredit: 0,
        alive: false, out: false, respawnT: 0.6, mineAmmo: C.MINE_BASE, carry: -1, joinN: 0,
      }, f);
    }

    // 套用坦克種類的數值（闖關敵軍的血量另外算）
    applyClass(p) {
      const c = CLASSES[p.cls] || CLASSES.medium;
      Object.assign(p, {
        r: c.r, spd: c.spd, dcd: c.dcd, maxAmmo: c.ammo, regen: c.regen, fcd0: c.fcd, dmg: c.dmg,
        bspd: c.bspd || C.BULLET_SPEED, kb: c.kb, see: c.see, mineSee: c.mineSee,
      });
      if (!p.enemy) p.maxHp = c.hp;
    }

    addPlayer({ name, color, ws, level, skin, cls }) {
      if (this.squad() >= MAX_PLAYERS) {
        if (ws) {
          const bot = this.allyBots()[0];
          if (!bot) return null;
          this.removePlayer(bot.id);
          this.settings.bots = this.allyBots().length;
        } else return null;
      }
      const p = this.newPlayer({
        name, ws: ws || null, bot: level ? new BotBrain(level) : null,
        skin: SKINS.includes(skin) ? skin : 'classic',
        cls: CLASSES[cls] ? cls : 'medium',
        joinN: ++this.joinCount,
      });
      this.applyClass(p);
      p.color = COLORS.includes(color) ? color : COLORS[p.id % COLORS.length];
      if (this.settings.mode === 'waves') p.team = 0;
      else if (this.isTeam()) p.team = this.smallerTeam();
      this.players.set(p.id, p);
      if (!p.bot && !this.hostId) this.hostId = p.id;
      if (this.state === 'playing') {
        // 大逃殺打到一半進來的人要等下一回合（原本只有一個人在練習的話就直接加入）
        if (this.settings.mode === 'br' && this.obj && this.obj.ph === 'fight') {
          if (this.obj.n >= 2) { p.out = true; p.alive = false; }
          else { this.spawn(p); this.obj.n++; }
        } else this.spawn(p);
      }
      this.infoDirty = true;
      this.sys(`${p.bot ? '🤖 ' : ''}${p.name} 加入了${this.state === 'waiting' ? '房間' : '戰場'}`);
      if (!p.bot) this.checkFull();
      return p;
    }

    removePlayer(id) {
      const p = this.players.get(id);
      if (!p) return;
      if (p.carry >= 0) this.dropFlag(p);
      this.players.delete(id);
      this.mines = this.mines.filter((m) => m.owner !== id);
      this.infoDirty = true;
      if (!p.enemy) this.sys(`${p.name} 離開了`);
      if (p.id === this.hostId) {
        // 房主走了就交給最早進來的真人
        const next = [...this.players.values()].filter((q) => !q.bot).sort((a, b) => a.joinN - b.joinN)[0];
        this.hostId = next ? next.id : 0;
        if (next) this.sys(`${next.name} 成為新的房主`);
      }
      if (this.state === 'waiting' && this.waitT !== null && !this.forced && this.humans() < this.settings.players) {
        this.waitT = null;
        this.sys('有人離開了，等人到齊再開始');
      }
    }

    smallerTeam() {
      const n = [0, 0];
      for (const p of this.players.values()) if (!p.enemy && p.team >= 0) n[p.team]++;
      return n[0] <= n[1] ? 0 : 1;
    }

    countTeam(t, except) {
      let n = 0;
      for (const q of this.players.values()) if (q !== except && !q.enemy && q.team === t) n++;
      return n;
    }

    // force：換模式時重新分隊；平常只修正不合法的狀態
    assignTeams(force) {
      const list = [...this.players.values()].filter((q) => !q.enemy);
      if (this.settings.mode === 'waves') { list.forEach((q) => (q.team = 0)); return; }
      if (!this.isTeam()) return;
      if (!force && this.countTeam(0) && this.countTeam(1)) return;
      const humans = list.filter((q) => !q.bot), bots = list.filter((q) => q.bot);
      humans.forEach((q, i) => (q.team = i % 2));
      bots.forEach((q) => (q.team = -1));
      bots.forEach((q) => (q.team = this.countTeam(0, q) <= this.countTeam(1, q) ? 0 : 1));
    }

    addBot(level, cls) {
      const used = new Set([...this.players.values()].map((p) => p.name));
      const pool = BOT_NAMES.filter((n) => !used.has(n));
      const name = pool.length ? pool[Math.floor(Math.random() * pool.length)] : `機器人${ids}`;
      const usedColors = new Set([...this.players.values()].map((p) => p.color));
      const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[ids % COLORS.length];
      const skin = SKINS[Math.floor(Math.random() * 4)];
      return this.addPlayer({ name, color, level, skin, cls: CLASSES[cls] ? cls : pickWeighted(BOT_CLASS_W) });
    }

    // 把電腦玩家數量調到 n 台
    setBots(n) {
      let bots = this.allyBots();
      while (bots.length > n) { this.removePlayer(bots[bots.length - 1].id); bots = this.allyBots(); }
      while (bots.length < n && this.squad() < MAX_PLAYERS) {
        const b = this.addBot(this.settings.level);
        if (!b) break;
        if (this.isTeam() && this.settings.mode !== 'waves') b.team = this.countTeam(0, b) <= this.countTeam(1, b) ? 0 : 1;
        bots = this.allyBots();
      }
      this.settings.bots = this.allyBots().length;
    }

    // ------------------------------------------------------------ 開房、等待室
    // 建立房間的人帶來的設定（模式、人數、電腦…）；人數 1 = 自己玩，直接開打
    applyCreate(c) {
      const s = this.settings;
      const int = (v, a, b, d) => (Number.isInteger(v) && v >= a && v <= b ? v : d);
      s.mode = MODES[c.mode] ? c.mode : 'ffa';
      s.target = MODES[s.mode].targets.includes(c.target) ? c.target : MODES[s.mode].def;
      s.time = TIMES.includes(c.time) ? c.time : 300;
      s.map = int(c.map, -1, MAPS.length - 1, -1);
      s.players = int(c.players, 1, MAX_PLAYERS, 2);
      s.level = LEVELS.includes(c.level) ? c.level : 'normal';
      this.assignTeams(true);
      this.setBots(int(c.bots, 0, MAX_PLAYERS - 1, 0));
      if (s.players <= 1) this.startMatch();
      else this.enterWaiting();
    }

    enterWaiting() {
      if (this.settings.map >= 0 && this.settings.map < MAPS.length) this.mapIdx = this.settings.map;
      this.loadMap();
      this.state = 'waiting';
      this.bullets = []; this.mines = []; this.powerups = []; this.pending = []; this.barrelRespawn = []; this.shells = []; this.drops = [];
      this.obj = null; this.winner = null; this.awards = null;
      this.matchTime = this.settings.mode === 'waves' ? Infinity : this.settings.time;
      this.interT = 0;
      this.waitT = null;
      this.forced = false;
      for (const p of [...this.players.values()]) if (p.enemy) this.players.delete(p.id);
      for (const p of this.players.values()) {
        Object.assign(p, { alive: false, out: false, carry: -1, flaming: false, kills: 0, deaths: 0, streak: 0, best: 0, score: 0, st: newStats(), air: 0 });
        p.inputQ.length = 0;
        if (p.nextCls) { p.cls = p.nextCls; p.nextCls = null; }
        this.applyClass(p);
      }
      this.assignTeams(false);
      this.broadcastMap();
      this.infoDirty = true;
    }

    // 等待室：真人到齊就倒數開打
    checkFull() {
      if (this.state !== 'waiting' || this.waitT !== null || this.settings.players <= 1) return;
      if (this.humans() >= this.settings.players) {
        this.waitT = 3.5;
        this.forced = false;
        this.sys('人到齊了，準備開打！');
        this.infoDirty = true;
      }
    }

    // ------------------------------------------------------------ 比賽流程
    loadMap() { this.map = parseMap(MAPS[this.mapIdx]); }

    startMatch() {
      if (this.settings.map >= 0 && this.settings.map < MAPS.length) this.mapIdx = this.settings.map;
      this.loadMap();
      this.bullets = []; this.mines = []; this.powerups = []; this.pending = []; this.barrelRespawn = []; this.shells = []; this.drops = [];
      this.state = 'playing';
      const mode = this.settings.mode;
      this.matchTime = mode === 'waves' ? Infinity : this.settings.time;
      this.interT = 0;
      this.waitT = null;
      this.winner = null;
      this.awards = null;
      this.puTimer = 4;
      this.supplyT = 2;
      this.dropT = C.DROP_FIRST;
      this.firstBlood = false;
      this.matchPoint = false;
      for (const p of [...this.players.values()]) if (p.enemy) this.players.delete(p.id);
      this.assignTeams(false);
      for (const p of this.players.values()) {
        Object.assign(p, { kills: 0, deaths: 0, streak: 0, best: 0, multiN: 0, lastKiller: null, mineAmmo: C.MINE_BASE, score: 0, st: newStats(), out: false, warned: false, carry: -1, air: 0, airCd: 0 });
        p.alive = false;
        if (p.bot) p.bot.reset();
      }
      this.obj = null;
      if (mode === 'ctf') {
        this.obj = { flags: this.map.flags.map((f, t) => ({ team: t, hx: f.x, hy: f.y, x: f.x, y: f.y, st: 0, by: 0, t: 0 })), caps: [0, 0], mp: [false, false] };
      } else if (mode === 'koth') {
        const h = this.map.hills[0];
        this.obj = { i: 0, x: h.x, y: h.y, r: C.HILL_R, moveT: C.HILL_MOVE, owner: 0, cont: false };
      } else if (mode === 'br') {
        this.obj = { round: 0, ph: 'fight', wait: 0, n: 0, z: null };
      } else if (mode === 'waves') {
        this.obj = { wave: 0, st: 'prep', t: 6, lives: 3 + Math.max(1, this.humans()), queue: [], left: 0, spawnT: 0, boss: 0, target: this.settings.target };
      }
      if (this.obj) this.obj.mode = mode;
      if (mode === 'br') this.brStartRound(true);
      else for (const p of this.players.values()) this.spawn(p);
      this.broadcastMap();
      this.infoDirty = true;
      this.event({ e: 'ann', t: this.map.name, s: `${this.M.name} · FIGHT!`, c: '#ffd84d', z: 'xl' });
    }

    endMatch(reason) {
      if (this.state !== 'playing') return;
      this.state = 'intermission';
      this.interT = 12;
      const mode = this.settings.mode;
      const list = [...this.players.values()].filter((p) => !p.enemy);
      if (mode === 'team' || mode === 'ctf') {
        const s = this.teamScores();
        let w = s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
        if (w < 0 && mode === 'ctf') { const k = this.teamKills(); w = k[0] === k[1] ? -1 : k[0] > k[1] ? 0 : 1; }
        this.winner = w < 0 ? { name: '平手', color: '#ffffff' } : { name: TEAM_NAMES[w], color: TEAM_COLORS[w], team: w };
      } else if (mode === 'waves') {
        const o = this.obj;
        const won = reason === 'clear';
        this.winner = { name: won ? '守住了！' : '全軍覆沒', color: won ? '#5cff6e' : '#ff5252', coop: 1, lost: won ? 0 : 1, wave: o.wave, cleared: won ? o.wave : Math.max(0, o.wave - 1) };
      } else {
        const key = mode === 'koth' || mode === 'br' ? (p) => Math.floor(p.score) : (p) => p.kills;
        list.sort((a, b) => key(b) - key(a) || b.kills - a.kills || a.deaths - b.deaths);
        const [a, b] = list;
        if (!a || (b && key(a) === key(b) && a.kills === b.kills && a.deaths === b.deaths)) this.winner = { name: '平手', color: '#ffffff' };
        else this.winner = { name: a.name, color: a.color, id: a.id };
      }
      for (const p of this.players.values()) p.flaming = false;
      this.bullets = [];
      this.shells = [];
      this.drops = [];
      this.awards = this.computeAwards();
      const w = this.winner;
      if (w.coop) this.event({ e: 'ann', t: w.lost ? `撐到第 ${w.wave} 波` : '🏆 守住了！', s: w.lost ? 'GAME OVER' : 'VICTORY', c: w.color, z: 'xl' });
      else this.event({ e: 'ann', t: w.name === '平手' ? '平手！' : `🏆 ${w.name} 獲勝！`, s: 'VICTORY', c: w.color, z: 'xl' });
      this.event({ e: 'end', w });
      this.infoDirty = true;
    }

    nextMap() {
      if (this.settings.map < 0) this.mapIdx = (this.mapIdx + 1) % MAPS.length;
      this.startMatch();
    }

    teamKills() {
      const s = [0, 0];
      for (const p of this.players.values()) if (!p.enemy && p.team >= 0) s[p.team] += p.kills;
      return s;
    }
    teamScores() {
      if (this.settings.mode === 'ctf' && this.obj && this.obj.caps) return this.obj.caps.slice();
      return this.teamKills();
    }

    computeAwards() {
      const list = [...this.players.values()].filter((p) => !p.enemy);
      const out = [];
      const mode = this.settings.mode;
      const pick = (k, icon, t, fn, min, fmt) => {
        let best = null, bv = min;
        for (const p of list) { const v = fn(p); if (v > bv) { bv = v; best = p; } }
        if (best) out.push({ k, id: best.id, icon, t, v: fmt ? fmt(bv) : '' });
      };
      const mvp = (p) => p.kills * 2 + p.st.caps * 6 + p.st.rets * 1.5 + p.st.hill / 4 + (mode === 'br' ? p.score * 4 : 0) + p.st.dmg / 60 - p.deaths * 0.7 + p.st.bossK * 3;
      pick('mvp', '🏆', 'MVP', mvp, -Infinity);
      if (mode === 'ctf') pick('flag', '🚩', '搶旗英雄', (p) => p.st.caps, 0, (v) => `${v} 分`);
      if (mode === 'koth') pick('hill', '⛰️', '山大王', (p) => Math.floor(p.st.hill), 4, (v) => `${v} 秒`);
      if (mode === 'br') pick('chicken', '🐔', '吃雞王', (p) => p.score, 0, (v) => `${v} 勝`);
      pick('dmg', '💥', '輸出王', (p) => Math.round(p.st.dmg), 0, (v) => `${v} 傷害`);
      pick('acc', '🎯', '神射手', (p) => (p.st.shots >= 8 ? p.st.hits / p.st.shots : 0), 0.05, (v) => `命中 ${Math.round(v * 100)}%`);
      pick('rico', '↩️', '反彈之神', (p) => p.st.rico, 0, (v) => `${v} 次反彈擊殺`);
      pick('air', '✈️', '空襲大師', (p) => p.st.airK, 0, (v) => `空襲炸掉 ${v} 台`);
      pick('streak', '🔥', '連殺王', (p) => p.best, 2, (v) => `${v} 連殺`);
      pick('arty', '🎇', '砲兵之王', (p) => p.st.artyK, 1, (v) => `砲擊 ${v} 殺`);
      pick('mine', '💣', '地雷大師', (p) => p.st.mineK, 0, (v) => `${v} 次`);
      pick('barrel', '🛢️', '爆破專家', (p) => p.st.barrelK, 0, (v) => `${v} 次`);
      pick('boss', '👹', '屠魔勇者', (p) => p.st.bossK, 0, (v) => `擊倒 BOSS ${v} 次`);
      return out.slice(0, 6);
    }

    // ------------------------------------------------------------ 出生
    pickSpawn(p) {
      let cands = this.map.spawns;
      if (this.isTeam()) {
        const half = (this.map.w * TILE) / 2;
        const side = cands.filter((s) => (p.team === 0 ? s.x < half : s.x >= half));
        if (side.length) cands = side;
      }
      const others = [...this.players.values()].filter((q) => q.alive && q !== p);
      const enemies = others.filter((q) => !this.isTeam() || q.team !== p.team);
      let best = cands[0], bestScore = -Infinity;
      for (const s of cands) {
        let score = Math.random() * 60;
        let near = Infinity;
        for (const e of enemies) near = Math.min(near, dist(s, e));
        score += near === Infinity ? 1000 : near;
        for (const o of others) if (dist(s, o) < p.r + o.r + 6) score -= 5000;
        if (score > bestScore) { bestScore = score; best = s; }
      }
      return best;
    }

    spawn(p) {
      if (!p.enemy) {
        // 換坦克種類在重生時生效
        if (p.nextCls) { p.cls = p.nextCls; p.nextCls = null; this.infoDirty = true; }
        this.applyClass(p);
      }
      const s = this.pickSpawn(p);
      const cx = (this.map.w * TILE) / 2, cy = (this.map.h * TILE) / 2;
      const ha = Math.atan2(cy - s.y, cx - s.x);
      Object.assign(p, {
        alive: true, out: false, x: s.x, y: s.y, vx: 0, vy: 0, ha, ta: ha, hp: p.maxHp, shield: 0, shieldT: 0,
        dashT: 0, dashCd: 0, slideT: 0, portLock: -1, ammo: p.maxAmmo, ammoT: 0, fireCd: 0.3,
        mineAmmo: Math.max(p.mineAmmo || 0, C.MINE_BASE), mineT: 0, mineCd: 0.3,
        special: null, specialN: 0, flameAcc: 0, flaming: false, airCd: 0,
        rapidT: 0, tripleT: 0, boostT: 0, boost: false, cloakT: 0, bounceT: 0, zoneAcc: 0,
        protectT: p.enemy ? 1.2 : C.PROTECT, revealT: 0, inBush: false, held: 0, lastHitBy: null, lastHitT: -99,
        justDashed: false, justPorted: null, justPadded: false, carry: -1,
      });
      if (p.enemy) {
        // 敵軍擠在同一個出生點的話稍微錯開
        p.x += (Math.random() - 0.5) * 30; p.y += (Math.random() - 0.5) * 30;
        Core.resolveTank(this.map, p);
      }
      if (p.boss) p.tripleT = 1e9;
      if (p.armor) { p.shield = p.armor; p.shieldT = 1e9; }
      this.event({ e: 'spawn', id: p.id, x: r1(p.x), y: r1(p.y) });
    }

    // ------------------------------------------------------------ 輸入
    // 每個輸入：[序號, 按鍵, 瞄準角度, 瞄準距離（自走砲用，可以省略）]
    input(p, list) {
      if (!Array.isArray(list)) return;
      for (const it of list.slice(0, 30)) {
        if (!Array.isArray(it)) continue;
        const [s, k, a, d] = it;
        if (typeof s !== 'number' || typeof k !== 'number' || typeof a !== 'number' || !isFinite(a)) continue;
        if (s <= p.lastSeq) continue;
        p.lastSeq = s;
        p.inputQ.push({ s, k: k & 255, a, d: typeof d === 'number' && isFinite(d) ? Core.clamp(d, 0, 2000) : 0 });
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
          if (p.justPorted) {
            const [fx, fy, tx, ty] = p.justPorted;
            p.justPorted = null;
            this.event({ e: 'port', id: p.id, x: r1(fx), y: r1(fy), x2: r1(tx), y2: r1(ty) });
          }
          if (p.justPadded) { p.justPadded = false; this.event({ e: 'pad', id: p.id, x: r1(p.x), y: r1(p.y) }); }
        }
        held |= inp.k;
        p.ta = inp.a;
        if (inp.d) p.tdist = inp.d;
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
        this.updateShells(dt);
        this.updateMines(dt);
        this.updatePending(dt);
        this.updateBarrels(dt);
        this.updatePowerups(dt);
        this.updateSupplies(dt);
        this.updateDrops(dt);
        this.updateMode(dt);
        this.matchTime -= dt;
        if (this.matchTime <= 0) this.endMatch('time');
      } else if (this.state === 'waiting') {
        if (this.waitT !== null) {
          const before = Math.ceil(this.waitT);
          this.waitT -= dt;
          if (Math.ceil(this.waitT) !== before) this.infoDirty = true;
          if (this.waitT <= 0) this.startMatch();
        }
      } else {
        this.interT -= dt;
        if (this.interT <= 0) this.nextMap();
      }
      this.reap(dt);

      if (this.tickN % 2 === 0) this.broadcast();
      const now = performance.now();
      if (this.infoDirty ? now - this.lastInfoAt > 200 : now - this.lastInfoAt > 1000) this.broadcastInfo();
    }

    // 被打爆的敵軍過一下子才移除（讓擊殺訊息還找得到名字）
    reap(dt) {
      for (const p of [...this.players.values()]) {
        if (p.removeT === undefined) continue;
        p.removeT -= dt;
        if (p.removeT <= 0) { this.players.delete(p.id); this.infoDirty = true; }
      }
    }

    updatePlayer(p, dt) {
      if (!p.alive) {
        if (p.out || p.removeT !== undefined) return; // 出局（大逃殺 / 闖關沒命了）不會自己復活
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.spawn(p);
        return;
      }
      p.fireCd -= dt; p.mineCd -= dt;
      if (p.airCd > 0) p.airCd -= dt;
      if (p.protectT > 0) p.protectT -= dt;
      if (p.revealT > 0) p.revealT -= dt;
      if (p.rapidT > 0) p.rapidT -= dt;
      if (p.tripleT > 0) p.tripleT -= dt;
      if (p.boostT > 0) p.boostT -= dt;
      if (p.cloakT > 0) p.cloakT -= dt;
      if (p.bounceT > 0) p.bounceT -= dt;
      if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) p.shield = 0; }
      if (p.ammo < p.maxAmmo) {
        p.ammoT += dt;
        if (p.ammoT >= p.regen) { p.ammo++; p.ammoT = 0; }
      } else p.ammoT = 0;
      if (p.mineAmmo < C.MINE_BASE) {
        p.mineT += dt;
        if (p.mineT >= C.MINE_REGEN) { p.mineAmmo++; p.mineT = 0; }
      } else p.mineT = 0;

      p.flaming = false;
      if (p.special === 'flame' && (p.held & K.FIRE)) this.updateFlame(p, dt);
      else if ((p.held & K.FIRE) && p.fireCd <= 0) this.fire(p);
      if ((p.held & K.MINE) && p.mineCd <= 0) this.placeMine(p);
      if ((p.held & K.CALL) && p.air > 0 && !(p.airCd > 0)) this.callAirstrike(p);
      if (!p.alive) return;

      p.inBush = Core.tileAt(this.map, Math.floor(p.x / TILE), Math.floor(p.y / TILE)) === T.BUSH;

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const u = this.powerups[i];
        if (u.k === 'crate' && p.enemy) continue; // 闖關的敵軍不會搶空投
        if (dist(u, p) < p.r + (u.k === 'crate' ? 20 : 16)) {
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
          const min = a.r + b.r;
          if (d < min) {
            const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
            const ma = a.r * a.r, mb = b.r * b.r; // 大台的比較推不動
            const pa = ((min - d) * mb) / (ma + mb), pb = ((min - d) * ma) / (ma + mb);
            a.x -= nx * pa; a.y -= ny * pa;
            b.x += nx * pb; b.y += ny * pb;
            Core.resolveTank(this.map, a);
            Core.resolveTank(this.map, b);
          }
        }
      }
    }

    // ------------------------------------------------------------ 武器
    useSpecial(p) {
      p.specialN--;
      if (p.specialN <= 0) { p.special = null; p.specialN = 0; }
    }

    fire(p) {
      const a = p.ta;
      p.protectT = 0;
      p.revealT = 0.9;
      const sp = p.special;
      if (sp === 'rail') { this.useSpecial(p); p.fireCd = C.RAIL_CD; p.st.shots++; this.fireRail(p, a, ++p.shotN); return; }
      if (sp === 'homing') { this.useSpecial(p); p.fireCd = 0.5; p.st.shots++; this.spawnMissile(p, a, ++p.shotN); return; }
      if (sp === 'shotgun') { this.useSpecial(p); p.fireCd = 0.55; p.st.shots++; this.fireShotgun(p, a, ++p.shotN); return; }
      const rapid = p.rapidT > 0;
      if (!rapid) {
        if (p.ammo < 1) { p.fireCd = 0.25; if (!p.bot) this.event({ e: 'dry', to: p.id }); return; }
        p.ammo--;
      }
      p.st.shots++;
      const shot = ++p.shotN;
      const c = CLASSES[p.cls] || CLASSES.medium;
      if (c.arty && !p.boss) {
        p.fireCd = rapid ? c.fcd * 0.45 : c.fcd;
        this.fireArtillery(p, a, shot);
        return;
      }
      p.fireCd = rapid ? Math.min(C.RAPID_CD, p.fcd0) : p.fcd0;
      const spread = p.tripleT > 0 ? [-0.17, 0, 0.17] : [0];
      for (const s of spread) this.spawnBullet(p, a + s + (rapid ? (Math.random() - 0.5) * 0.07 : 0), rapid, shot);
      const m = p.r + 9;
      this.event({ e: 'shot', id: p.id, x: r1(p.x + Math.cos(a) * m), y: r1(p.y + Math.sin(a) * m), a: r2(a), k: rapid ? 1 : p.cls === 'td' ? 5 : p.cls === 'heavy' ? 6 : 0 });
    }

    projectile(p, a, sp, f) {
      const b = Object.assign({
        id: ids++, owner: p.id, team: p.team, x: p.x, y: p.y, px: p.x, py: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, bounces: 0, maxB: 0, life: 1, dmg: 0, kind: 0, sx: p.x, sy: p.y, pl: -1,
      }, f);
      if (Core.stepBullet(this.map, b, (p.r + 5) / sp, this.onBulletTile)) this.bullets.push(b);
      return b;
    }

    // 一般砲彈：傷害和速度看坦克種類（kind 0 一般、1 連射、5 驅逐戰車穿甲彈、6 重坦大砲彈）
    spawnBullet(p, a, rapid, shot) {
      const bouncy = p.bounceT > 0;
      const td = p.cls === 'td' && !rapid, heavy = p.cls === 'heavy' && !rapid;
      this.projectile(p, a, p.bspd * (rapid ? 1.1 : 1), {
        maxB: bouncy ? C.BOUNCE_MAX : C.BULLET_BOUNCES, life: C.BULLET_LIFE * (bouncy ? 1.3 : 1) * (td ? 0.75 : 1),
        dmg: p.boss ? 30 : rapid ? Math.round(p.dmg * 0.65) : p.dmg, kind: rapid ? 1 : td ? 5 : heavy ? 6 : 0, shot,
      });
    }

    // 自走砲：拋射砲彈飛到瞄準點落地爆炸，中間不會被牆擋住；三連發會有三個落點
    fireArtillery(p, a, shot) {
      const d = Core.clamp(p.tdist || 300, C.ARTY_MIN, C.ARTY_MAX);
      const W = this.map.w * TILE, H = this.map.h * TILE;
      const offs = p.tripleT > 0 ? [-1, 0, 1] : [0];
      for (const o of offs) {
        const tx = Core.clamp(p.x + Math.cos(a) * d - Math.sin(a) * o * 55, TILE / 2, W - TILE / 2);
        const ty = Core.clamp(p.y + Math.sin(a) * d + Math.cos(a) * o * 55, TILE / 2, H - TILE / 2);
        const dd = Math.hypot(tx - p.x, ty - p.y);
        this.shells.push({ id: ids++, kind: 0, x0: p.x, y0: p.y, tx, ty, t: 0, T: C.ARTY_T0 + dd / C.ARTY_SPD, owner: p.id, team: p.team, dmg: p.dmg, r: C.ARTY_RADIUS, shot });
      }
      const m = p.r + 9;
      this.event({ e: 'shot', id: p.id, x: r1(p.x + Math.cos(a) * m), y: r1(p.y + Math.sin(a) * m), a: r2(a), k: 4 });
    }

    spawnMissile(p, a, shot) {
      this.projectile(p, a, C.MISSILE_SPEED, { life: C.MISSILE_LIFE, kind: 2, shot });
      const m = p.r + 9;
      this.event({ e: 'shot', id: p.id, x: r1(p.x + Math.cos(a) * m), y: r1(p.y + Math.sin(a) * m), a: r2(a), k: 2 });
    }

    fireShotgun(p, a, shot) {
      for (let i = 0; i < C.PELLETS; i++) {
        const s = (i / (C.PELLETS - 1) - 0.5) * 2 * C.PELLET_SPREAD + (Math.random() - 0.5) * 0.06;
        this.projectile(p, a + s, C.PELLET_SPEED * (0.9 + Math.random() * 0.2), {
          life: C.PELLET_LIFE * (0.85 + Math.random() * 0.3), dmg: C.PELLET_DMG, kind: 3, shot,
        });
      }
      const m = p.r + 9;
      this.event({ e: 'shot', id: p.id, x: r1(p.x + Math.cos(a) * m), y: r1(p.y + Math.sin(a) * m), a: r2(a), k: 3 });
    }

    // 火焰噴射：每 0.1 秒對前方扇形範圍造成一次傷害（不產生砲彈，所以很省網路）
    updateFlame(p, dt) {
      p.flaming = true;
      p.protectT = 0;
      p.revealT = 0.9;
      p.specialN -= dt;
      p.flameAcc += dt;
      while (p.flameAcc >= 0.1) { p.flameAcc -= 0.1; this.flamePulse(p); }
      if (p.specialN <= 0) { p.special = null; p.specialN = 0; p.flaming = false; }
    }

    flamePulse(p) {
      const a = p.ta, R = C.FLAME_RANGE, team = this.isTeam();
      const ox = p.x + Math.cos(a) * (p.r + 3), oy = p.y + Math.sin(a) * (p.r + 3);
      const inCone = (x, y, rad) => {
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
        if (d > R + rad || d < 1) return false;
        return Math.abs(Core.angDiff(Math.atan2(dy, dx), a)) < C.FLAME_ARC + Math.atan2(rad, d);
      };
      for (const q of this.players.values()) {
        if (!q.alive || q === p || (team && q.team === p.team)) continue;
        if (!inCone(q.x, q.y, q.r) || !Core.lineClear(this.map, ox, oy, q.x, q.y)) continue;
        this.damage(q, C.FLAME_DPS * 0.1, p.id, 'flame', { from: p });
      }
      for (const m of this.mines) {
        if (m.dead || m.arm > 0 || !inCone(m.x, m.y, 8) || !Core.lineClear(this.map, ox, oy, m.x, m.y)) continue;
        m.dead = true;
        this.pending.push({ t: 0.05, type: 'mine', m, by: p.id });
      }
      const { w, tiles } = this.map;
      const x0 = Math.max(0, Math.floor((p.x - R) / TILE)), x1 = Math.min(w - 1, Math.floor((p.x + R) / TILE));
      const y0 = Math.max(0, Math.floor((p.y - R) / TILE)), y1 = Math.min(this.map.h - 1, Math.floor((p.y + R) / TILE));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = tiles[ty * w + tx];
          if (t !== T.BARREL && t !== T.BRICK) continue;
          const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
          if (!inCone(cx, cy, 16)) continue;
          const d = Math.hypot(cx - ox, cy - oy) || 1;
          if (!Core.lineClear(this.map, ox, oy, cx - ((cx - ox) / d) * 22, cy - ((cy - oy) / d) * 22)) continue;
          if (t === T.BARREL) this.pending.push({ t: 0.12, type: 'barrel', tx, ty, owner: p.id });
          else if (Math.random() < 0.22) this.damageBrick(tx, ty, 1);
        }
      }
    }

    onBulletTile(b, tx, ty, tt, hx, hy) {
      if (b.kind === 2) {
        if (tt === T.BARREL) this.explodeBarrel(tx, ty, b.owner);
        this.missileBoom(b);
        return false;
      }
      if (tt === T.STEEL) {
        if (b.bounces < b.maxB) {
          b.bounces++;
          this.event({ e: 'bnc', x: r1(hx), y: r1(hy) });
          return true;
        }
        this.event({ e: 'spark', x: r1(hx), y: r1(hy) });
        return false;
      }
      if (tt === T.BRICK) { this.damageBrick(tx, ty, b.kind === 5 || b.kind === 6 ? 2 : 1); this.event({ e: 'spark', x: r1(hx), y: r1(hy), b: 1 }); return false; }
      if (tt === T.BARREL) { this.explodeBarrel(tx, ty, b.owner); return false; }
      return false;
    }

    missileBoom(b) {
      if (b.boomed) return;
      b.boomed = b.dead = true;
      this.explode(b.x, b.y, C.MISSILE_RADIUS, C.MISSILE_DMG, b.owner, 'missile', b.shot);
    }

    steerMissile(b, dt) {
      const owner = this.players.get(b.owner);
      if (!owner) return;
      const team = this.isTeam();
      const a0 = Math.atan2(b.vy, b.vx);
      let best = null, bs = Infinity;
      for (const q of this.players.values()) {
        if (!q.alive || q.id === b.owner || q.protectT > 0 || (team && q.team === b.team)) continue;
        if (!this.canSee(owner, q)) continue;
        const dx = q.x - b.x, dy = q.y - b.y, d = Math.hypot(dx, dy);
        if (d > C.MISSILE_RANGE) continue;
        const da = Math.abs(Core.angDiff(Math.atan2(dy, dx), a0));
        if (da > 1.3) continue;
        const s = d * (1 + da);
        if (s < bs) { bs = s; best = q; }
      }
      if (!best) return;
      const want = Math.atan2(best.y - b.y, best.x - b.x);
      const na = a0 + Core.clamp(Core.angDiff(want, a0), -C.MISSILE_TURN * dt, C.MISSILE_TURN * dt);
      const sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
    }

    fireRail(p, a, shot) {
      const res = Core.castRay(this.map, p.x, p.y, a, C.RAIL_LEN, C.RAIL_BOUNCES, true, true);
      this.event({ e: 'rail', id: p.id, segs: res.segs.map((s) => s.map(([x, y]) => [r1(x), r1(y)])) });
      const hit = new Set();
      const team = this.isTeam();
      let first = true;
      res.segs.forEach((pts, si) => {
        for (let s = 0; s < pts.length - 1; s++) {
          const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
          for (const q of this.players.values()) {
            if (!q.alive || hit.has(q)) continue;
            if (q === p && first) continue;
            if (team && q.team === p.team && q !== p) continue;
            if (Core.segPointDist(x0, y0, x1, y1, q.x, q.y) < q.r + 5) {
              hit.add(q);
              if (q !== p && p.lastCredit !== shot) { p.st.hits++; p.lastCredit = shot; }
              this.damage(q, C.RAIL_DMG, p.id, 'rail', { bounce: s > 0 || si > 0, rail: true, from: p });
            }
          }
          for (const m of this.mines) {
            if (!m.dead && Core.segPointDist(x0, y0, x1, y1, m.x, m.y) < 12) {
              m.dead = true;
              this.pending.push({ t: 0.05, type: 'mine', m, by: p.id });
            }
          }
          first = false;
        }
      });
      for (const h of res.hits) {
        if (h.t === T.BRICK) this.damageBrick(h.tx, h.ty, 99);
        else if (h.t === T.BARREL) this.pending.push({ t: 0.06, type: 'barrel', tx: h.tx, ty: h.ty, owner: p.id });
      }
    }

    placeMine(p) {
      if (p.mineAmmo <= 0) { p.mineCd = 0.4; if (!p.bot) this.event({ e: 'dry', to: p.id, m: 1 }); return; }
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
      const team = this.isTeam();
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
          if (Math.hypot(q.x - m.x, q.y - m.y) < C.MINE_TRIGGER + q.r * 0.5) {
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

    // 穿過傳送門的砲彈要分兩段判定碰撞
    bulletDist(b, x, y) {
      if (b.tp) return Math.min(Core.segPointDist(b.px, b.py, b.tp[0], b.tp[1], x, y), Core.segPointDist(b.tp[2], b.tp[3], b.x, b.y, x, y));
      return Core.segPointDist(b.px, b.py, b.x, b.y, x, y);
    }

    updateBullets(dt) {
      const team = this.isTeam();
      for (const b of this.bullets) {
        if (b.dead) continue;
        if (b.kind === 2) this.steerMissile(b, dt);
        b.px = b.x; b.py = b.y; b.tp = null;
        const alive = Core.stepBullet(this.map, b, dt, this.onBulletTile);
        b.life -= dt;
        if (!alive) b.dead = true;
        else if (b.life <= 0) {
          if (b.kind === 2) this.missileBoom(b);
          else { b.dead = true; this.event({ e: 'fizzle', x: r1(b.x), y: r1(b.y), s: 1 }); }
        }
      }
      const pellets = new Map();
      for (const b of this.bullets) {
        if (b.dead) continue;
        for (const q of this.players.values()) {
          if (!q.alive) continue;
          if (q.id === b.owner && b.bounces === 0) continue;
          if (team && q.team === b.team && q.id !== b.owner) continue;
          if (this.bulletDist(b, q.x, q.y) >= q.r + (b.kind === 3 ? 2 : 3)) continue;
          b.dead = true;
          if (b.kind === 2) { this.missileBoom(b); break; }
          const owner = this.players.get(b.owner);
          if (owner && q !== owner && owner.lastCredit !== b.shot) { owner.st.hits++; owner.lastCredit = b.shot; }
          if (b.kind === 3) {
            // 同一發霰彈打中同一台坦克的彈丸合併成一次傷害
            const key = q.id + ':' + b.owner;
            const acc = pellets.get(key);
            if (acc) acc.dmg += b.dmg; else pellets.set(key, { q, dmg: b.dmg, by: b.owner, from: owner });
          } else this.damage(q, b.dmg, b.owner, 'shell', { bounce: b.bounces > 0, from: owner, sx: b.sx, sy: b.sy });
          break;
        }
        if (b.dead) continue;
        for (const m of this.mines) {
          if (m.dead) continue;
          if (this.bulletDist(b, m.x, m.y) < 10) {
            b.dead = true;
            if (b.kind === 2) this.missileBoom(b);
            this.detonateMine(m, b.owner);
            break;
          }
        }
      }
      for (const h of pellets.values()) this.damage(h.q, h.dmg, h.by, 'shotgun', { from: h.from });
      // 砲彈互撞抵銷（自己的砲彈不會互撞，三連發 / 霰彈才不會一出膛就抵銷）
      const bs = this.bullets;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (a.dead || a.tp) continue;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (b.dead || b.tp || a.owner === b.owner) continue;
          const dx0 = a.px - b.px, dy0 = a.py - b.py;
          const ddx = (a.x - a.px) - (b.x - b.px), ddy = (a.y - a.py) - (b.y - b.py);
          const l2 = ddx * ddx + ddy * ddy;
          let t = l2 > 0 ? -(dx0 * ddx + dy0 * ddy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = dx0 + ddx * t, cy = dy0 + ddy * t;
          if (cx * cx + cy * cy < (a.kind === 2 || b.kind === 2 ? 144 : 64)) {
            a.dead = b.dead = true;
            const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
            this.event({ e: 'clash', x: r1(x), y: r1(y) });
            // 打下飛彈會小爆炸（算打的人的）
            if (a.kind === 2 || b.kind === 2) { a.boomed = b.boomed = true; this.explode(x, y, 44, 16, a.kind === 2 ? b.owner : a.owner, 'missile'); }
            break;
          }
        }
      }
      this.bullets = this.bullets.filter((b) => !b.dead);
      this.mines = this.mines.filter((m) => !m.dead);
    }

    // ------------------------------------------------------------ 拋射砲彈與空襲炸彈
    // shells：kind 0 自走砲砲彈（從 x0,y0 飛到 tx,ty）、kind 1 空襲炸彈（t < 0 代表還沒輪到它）
    updateShells(dt) {
      if (!this.shells.length) return;
      for (const s of this.shells) {
        s.t += dt;
        if (s.kind === 1 && s.tx === null && s.t >= 0) this.bombTarget(s);
        if (s.t >= s.T) {
          s.dead = true;
          if (s.tx === null) this.bombTarget(s);
          this.explode(s.tx, s.ty, s.r, s.dmg, s.owner, s.kind === 1 ? 'air' : 'arty', s.shot, s.kind === 1);
        }
      }
      this.shells = this.shells.filter((s) => !s.dead);
    }

    // 空襲：每顆炸彈開始預警的時候才決定落點，大多落在敵人附近（往敵人移動的方向偏一點），一部分亂丟
    bombTarget(s) {
      const team = this.isTeam();
      const foes = [...this.players.values()].filter((q) => q.alive && q.id !== s.owner && !(team && q.team === s.team));
      const W = this.map.w * TILE, H = this.map.h * TILE;
      let x, y;
      if (foes.length && Math.random() < 0.82) {
        const e = foes[Math.floor(Math.random() * foes.length)];
        const a = Math.random() * Math.PI * 2, r = Math.random() * C.AIR_SPREAD;
        x = e.x + (e.vx || 0) * 0.35 + Math.cos(a) * r;
        y = e.y + (e.vy || 0) * 0.35 + Math.sin(a) * r;
      } else {
        x = TILE + Math.random() * (W - 2 * TILE);
        y = TILE + Math.random() * (H - 2 * TILE);
      }
      s.tx = s.x0 = Core.clamp(x, TILE / 2, W - TILE / 2);
      s.ty = s.y0 = Core.clamp(y, TILE / 2, H - TILE / 2);
    }

    callAirstrike(p) {
      p.air--;
      p.airCd = 1.5;
      for (let i = 0; i < C.AIR_BOMBS; i++) {
        this.shells.push({ id: ids++, kind: 1, x0: 0, y0: 0, tx: null, ty: null, t: -i * C.AIR_GAP, T: C.AIR_WARN, owner: p.id, team: p.team, dmg: C.AIR_DMG, r: C.AIR_RADIUS, shot: 0 });
      }
      // 轟炸機飛過敵人上空（純畫面效果）
      const team = this.isTeam();
      const foes = [...this.players.values()].filter((q) => q.alive && q !== p && !(team && q.team === p.team));
      const W = this.map.w * TILE, H = this.map.h * TILE;
      let cx = W / 2, cy = H / 2;
      if (foes.length) { cx = foes.reduce((s, q) => s + q.x, 0) / foes.length; cy = foes.reduce((s, q) => s + q.y, 0) / foes.length; }
      const a = Math.random() * Math.PI * 2, L = Math.hypot(W, H) * 0.75;
      this.event({ e: 'plane', x0: r1(cx - Math.cos(a) * L), y0: r1(cy - Math.sin(a) * L), x1: r1(cx + Math.cos(a) * L), y1: r1(cy + Math.sin(a) * L), T: 3, k: 1 });
      this.event({ e: 'aircall', id: p.id });
      this.ann(`✈️ ${p.name} 呼叫了空襲！`, 'AIR STRIKE', '#ff9f43', 'm');
    }

    // ------------------------------------------------------------ 補給包、空投
    updateSupplies(dt) {
      this.supplyT -= dt;
      if (this.supplyT > 0) return;
      this.supplyT = this.settings.mode === 'br' ? 4 + Math.random() * 2 : 5 + Math.random() * 3;
      const spots = this.map.supplySpots;
      if (!spots.length) return;
      let have = 0;
      for (const u of this.powerups) if (u.k === 'supply') have++;
      if (have >= Math.ceil(spots.length / 2)) return;
      const free = spots.filter((s) => !this.powerups.some((u) => u.x === s.x && u.y === s.y));
      if (!free.length) return;
      const s = free[Math.floor(Math.random() * free.length)];
      this.powerups.push({ id: ids++, x: s.x, y: s.y, k: 'supply' });
      this.event({ e: 'puspawn', x: s.x, y: s.y, k: 'supply' });
    }

    updateDrops(dt) {
      for (const d of this.drops) {
        d.t -= dt;
        if (d.t > 0) continue;
        d.done = true;
        this.powerups.push({ id: ids++, x: d.x, y: d.y, k: 'crate' });
        this.event({ e: 'land', x: d.x, y: d.y });
      }
      if (this.drops.length) this.drops = this.drops.filter((d) => !d.done);
      this.dropT -= dt;
      if (this.dropT > 0) return;
      this.dropT = C.DROP_MIN + Math.random() * (C.DROP_MAX - C.DROP_MIN);
      let crates = this.drops.length;
      for (const u of this.powerups) if (u.k === 'crate') crates++;
      if (crates >= C.DROP_GROUND || !this.spawnDrop()) this.dropT = 8;
    }

    // 空投：飛機飛過，箱子掛著降落傘掉在某塊空地上（離大家都有點距離，大逃殺會掉在圈內）
    spawnDrop() {
      const spots = this.map.dropSpots;
      if (!spots.length) return false;
      const alive = [...this.players.values()].filter((p) => p.alive);
      const z = this.settings.mode === 'br' && this.obj && this.obj.z;
      let best = null, bs = -Infinity;
      for (let i = 0; i < 30; i++) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        if (z && Math.hypot(s.x - z.cx, s.y - z.cy) > z.r - 60) continue;
        if (this.powerups.some((u) => Math.hypot(u.x - s.x, u.y - s.y) < 40)) continue;
        let near = Infinity;
        for (const p of alive) near = Math.min(near, Math.hypot(p.x - s.x, p.y - s.y));
        const score = Math.min(near, 420) + Math.random() * 140;
        if (score > bs) { bs = score; best = s; }
      }
      if (!best) return false;
      const a = Math.random() * Math.PI * 2, L = 1000, fly = 1.2;
      this.drops.push({ id: ids++, x: best.x, y: best.y, t: C.DROP_FALL + fly });
      this.event({ e: 'plane', x0: r1(best.x - Math.cos(a) * L), y0: r1(best.y - Math.sin(a) * L), x1: r1(best.x + Math.cos(a) * L), y1: r1(best.y + Math.sin(a) * L), T: fly * 2, k: 0 });
      this.event({ e: 'drop', x: best.x, y: best.y });
      this.ann('📦 空投補給來了！', 'AIRDROP', '#ffd84d', 'm');
      return true;
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

    // noSelf：空襲不會炸到呼叫的人和隊友
    explode(x, y, radius, dmg, ownerId, weapon, shot, noSelf) {
      this.event({ e: 'boom', x: r1(x), y: r1(y), r: radius, k: weapon });
      const owner = this.players.get(ownerId);
      const team = this.isTeam();
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (noSelf && (p.id === ownerId || (team && owner && p.team === owner.team))) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        const reach = radius + p.r * 0.5;
        if (d >= reach) continue;
        const f = 1 - d / reach;
        let dm = dmg * (0.35 + 0.65 * f);
        if (p.id === ownerId) dm *= 0.5;
        const nx = d > 0.1 ? (p.x - x) / d : Math.cos(p.ha), ny = d > 0.1 ? (p.y - y) / d : Math.sin(p.ha);
        const imp = (120 + 480 * f) * (p.kb || 1);
        p.vx += nx * imp; p.vy += ny * imp;
        if (shot && owner && p !== owner && !(team && p.team === owner.team) && owner.lastCredit !== shot) { owner.st.hits++; owner.lastCredit = shot; }
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
        else if (it.type === 'tankboom') this.explode(it.x, it.y, it.r || 70, it.d || 22, it.owner, 'boom');
      }
    }

    damage(victim, dmg, attackerId, weapon, extra) {
      if (!victim.alive || victim.protectT > 0 || this.state !== 'playing') return;
      const att = this.players.get(attackerId);
      if (this.isTeam() && att && att !== victim && att.team === victim.team) return;
      let absorbed = 0;
      if (victim.shield > 0) {
        absorbed = Math.min(victim.shield, dmg);
        victim.shield -= absorbed;
        dmg -= absorbed;
      }
      victim.hp -= dmg;
      const total = dmg + absorbed;
      if (att && att !== victim) { att.st.dmg += total; victim.lastHitBy = att.id; victim.lastHitT = this.time; }
      const ev = { e: 'hit', id: victim.id, by: attackerId, d: Math.round(total), s: absorbed > 0 ? 1 : 0, x: r1(victim.x), y: r1(victim.y) };
      if (weapon === 'flame' || weapon === 'zone') ev.f = 1;
      this.event(ev);
      if (victim.hp <= 0.5) this.kill(victim, att, weapon, extra || {});
    }

    // k：'kill' 代表擊殺相關的播報（觀戰的人不會在畫面中央看到）
    ann(t, s, c, z, to, k) { this.event({ e: 'ann', t, s, c: c || '#ffffff', z: z || 'l', to, k }); }

    kill(victim, killer, weapon, extra) {
      victim.alive = false;
      victim.hp = 0;
      victim.flaming = false;
      victim.respawnT = C.RESPAWN;
      victim.deaths++;
      let k = killer;
      let forced = false;
      if ((!k || k === victim) && victim.lastHitBy && this.time - victim.lastHitT < 4) {
        const k2 = this.players.get(victim.lastHitBy);
        if (k2 && k2 !== victim) { k = k2; forced = true; }
      }
      const vStreak = victim.streak;
      victim.streak = 0;
      const ev = { e: 'kill', k: k ? k.id : victim.id, v: victim.id, w: weapon, x: r1(victim.x), y: r1(victim.y) };
      if (victim.carry >= 0) this.dropFlag(victim);
      const mode = this.settings.mode;

      if (k && k !== victim) {
        k.kills++;
        k.streak++;
        k.best = Math.max(k.best, k.streak);
        k.multiN = this.time - k.multiT < 4 ? k.multiN + 1 : 1;
        k.multiT = this.time;
        const bounce = extra.bounce && !forced;
        if (bounce) { ev.b = 1; k.st.rico++; }
        if (forced) ev.f = 1;
        if (!forced) {
          if (weapon === 'mine') k.st.mineK++;
          else if (weapon === 'barrel') k.st.barrelK++;
          else if (weapon === 'flame') k.st.flameK++;
          else if (weapon === 'missile') k.st.missileK++;
          else if (weapon === 'rail') k.st.railK++;
          else if (weapon === 'air') k.st.airK++;
          else if (weapon === 'arty') k.st.artyK++;
        }
        if (victim.boss) { k.st.bossK++; ev.boss = 1; }

        if (!k.enemy) {
          if (!this.firstBlood) { this.firstBlood = true; this.ann(`${k.name} 拿下首殺！`, 'FIRST BLOOD', '#ff5252', 'l', undefined, 'kill'); }
          const mm = MULTI[Math.min(k.multiN, 5)];
          if (mm) this.ann(`${k.name}　${mm[0]}`, mm[1], '#ffb142', 'xl', undefined, 'kill');
          if (STREAK[k.streak]) this.ann(`${k.name} ${STREAK[k.streak][0]}！`, STREAK[k.streak][1], '#c77dff', 'l', undefined, 'kill');
          if (vStreak >= 3) this.ann(`${k.name} 終結了 ${victim.name} 的 ${vStreak} 連殺！`, 'SHUTDOWN', '#00e5d4', 'l', undefined, 'kill');
          if (k.lastKiller === victim.id) { this.ann('復仇成功！', 'REVENGE', '#ff6ec7', 'm', k.id, 'kill'); k.lastKiller = null; }
          if (bounce) this.ann(extra.rail ? '雷射折射擊殺！' : '神之反彈！', 'RICOCHET', '#5cff6e', 'm', k.id, 'kill');
          if (forced) this.ann('逼他自爆！', 'DENIED', '#5cff6e', 'm', k.id, 'kill');
          if (!forced && weapon === 'shell' && extra.sx !== undefined && Math.hypot(extra.sx - victim.x, extra.sy - victim.y) > 650) this.ann('遠程狙殺！', 'LONG SHOT', '#4da6ff', 'm', k.id, 'kill');
          if (weapon === 'mine' && extra.from === k) this.ann('地雷大師！', 'BOOM!', '#ff9f43', 'm', k.id, 'kill');
        }
        victim.lastKiller = k.id;

        if (mode === 'team') {
          const s = this.teamScores();
          if (s[k.team] >= this.settings.target) this.endMatch();
          else if (!this.matchPoint && s[k.team] === this.settings.target - 1) { this.matchPoint = true; this.ann(`${TEAM_NAMES[k.team]} 賽點！`, 'MATCH POINT', TEAM_COLORS[k.team], 'l'); }
        } else if (mode === 'ffa') {
          if (k.kills >= this.settings.target) this.endMatch();
          else if (k.kills === this.settings.target - 1) this.ann(`${k.name} 賽點！`, 'MATCH POINT', '#ffd84d', 'l');
        }
      } else if (weapon === 'zone') {
        ev.zone = 1;
        this.ann('被毒圈吞噬了 ☠️', 'OUT OF ZONE', '#c77dff', 'm', victim.id, 'kill');
      } else {
        if (!victim.enemy) victim.kills--;
        ev.self = 1;
        this.ann(weapon === 'mine' ? '被自己的地雷炸飛 🤡' : weapon === 'shell' ? '被自己的砲彈打爆 🤡' : '把自己炸上天了 🤡', 'SELF DESTRUCT', '#aaaaaa', 'm', victim.id, 'kill');
      }
      this.event(ev);
      this.pending.push({ t: 0.05, type: 'tankboom', x: victim.x, y: victim.y, owner: k ? k.id : victim.id, r: victim.boss ? 120 : 70, d: victim.boss ? 40 : 22 });
      this.infoDirty = true;

      if (mode === 'br') victim.out = true;
      else if (mode === 'waves') this.wavesOnDeath(victim);
      if (victim.enemy) victim.removeT = 1.5;
    }

    applyPowerup(p, k) {
      switch (k) {
        case 'heal': p.hp = Math.min(p.maxHp, p.hp + 50); break;
        case 'shield': p.shield = Math.max(p.shield, 60); p.shieldT = 12; break;
        case 'rapid': p.rapidT = 7; break;
        case 'triple': p.tripleT = 10; break;
        case 'mines': p.mineAmmo = Math.min(C.MINE_CAP, p.mineAmmo + 3); break;
        case 'speed': p.boostT = 8; break;
        case 'cloak': p.cloakT = C.CLOAK_TIME; break;
        case 'bounce': p.bounceT = C.BOUNCE_TIME; break;
        case 'rail': case 'homing': case 'shotgun': case 'flame':
          // 特殊武器一次只能拿一種，撿到新的會換掉舊的
          p.special = k; p.specialN = SPECIAL[k]; p.flameAcc = 0;
          break;
        case 'supply':
          p.hp = Math.min(p.maxHp, p.hp + C.SUPPLY_HEAL);
          p.ammo = p.maxAmmo; p.ammoT = 0;
          p.mineAmmo = Math.min(C.MINE_CAP, p.mineAmmo + 1);
          break;
        case 'crate':
          // 空投：補滿血、彈藥、地雷，再加一次呼叫空襲
          p.air = Math.min(C.AIR_MAX, (p.air || 0) + 1);
          p.hp = p.maxHp; p.ammo = p.maxAmmo; p.ammoT = 0;
          p.mineAmmo = Math.min(C.MINE_CAP, p.mineAmmo + 2);
          p.st.crates++;
          this.ann(`📦 ${p.name} 搶到空投！`, '小心空襲', p.color, 'm');
          break;
      }
    }

    updatePowerups(dt) {
      this.puTimer -= dt;
      if (this.puTimer > 0) return;
      const br = this.settings.mode === 'br';
      this.puTimer = br ? 4 + Math.random() * 3 : this.settings.mode === 'waves' ? 6 + Math.random() * 3 : 7 + Math.random() * 4;
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
        for (const p of this.players.values()) if (p.alive && Math.abs(p.x - cx) < TILE / 2 + p.r + 2 && Math.abs(p.y - cy) < TILE / 2 + p.r + 2) blocked = true;
        for (const m of this.mines) if (Math.hypot(m.x - cx, m.y - cy) < 30) blocked = true;
        for (const u of this.powerups) if (Math.hypot(u.x - cx, u.y - cy) < 30) blocked = true;
        if (blocked) { b.t = 1; continue; }
        b.done = true;
        this.map.tiles[b.i] = T.BARREL;
        this.event({ e: 'tile', i: b.i, v: T.BARREL });
      }
      this.barrelRespawn = this.barrelRespawn.filter((b) => !b.done);
    }

    // ------------------------------------------------------------ 模式規則
    updateMode(dt) {
      if (!this.obj || this.obj.mode !== this.settings.mode) return;
      switch (this.settings.mode) {
        case 'ctf': this.updateCTF(dt); break;
        case 'koth': this.updateKOTH(dt); break;
        case 'br': this.updateBR(dt); break;
        case 'waves': this.updateWaves(dt); break;
      }
    }

    // ---- 搶旗
    updateCTF(dt) {
      const o = this.obj;
      for (const f of o.flags) {
        if (f.st === 1) {
          const c = this.players.get(f.by);
          if (!c || !c.alive || c.carry !== f.team) { f.st = 2; f.t = C.FLAG_RETURN; f.by = 0; this.event({ e: 'flag', a: 'drop', team: f.team, x: r1(f.x), y: r1(f.y) }); }
          else { f.x = c.x; f.y = c.y; }
        } else if (f.st === 2) {
          f.t -= dt;
          if (f.t <= 0) this.returnFlag(f, null);
        }
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        for (const f of o.flags) {
          if (f.st === 1 || Math.hypot(p.x - f.x, p.y - f.y) > C.FLAG_R + p.r) continue;
          if (f.team !== p.team) { if (p.carry < 0) this.takeFlag(f, p); }
          else if (f.st === 2) this.returnFlag(f, p);
          else if (p.carry >= 0) this.capture(p);
          if (this.state !== 'playing') return;
        }
      }
    }

    takeFlag(f, p) {
      f.st = 1; f.by = p.id;
      p.carry = f.team;
      p.protectT = 0;
      this.event({ e: 'flag', a: 'take', team: f.team, id: p.id, x: r1(f.x), y: r1(f.y) });
      this.ann(`${p.name} 搶走了${TEAM_NAMES[f.team]}的旗子！`, 'FLAG TAKEN', TEAM_COLORS[p.team], 'm');
      this.infoDirty = true;
    }

    dropFlag(p) {
      if (this.settings.mode !== 'ctf' || !this.obj || !this.obj.flags) { p.carry = -1; return; }
      const f = this.obj.flags[p.carry];
      p.carry = -1;
      if (!f || f.st !== 1) return;
      f.st = 2; f.x = p.x; f.y = p.y; f.t = C.FLAG_RETURN; f.by = 0;
      this.event({ e: 'flag', a: 'drop', team: f.team, x: r1(f.x), y: r1(f.y) });
      this.infoDirty = true;
    }

    returnFlag(f, p) {
      f.st = 0; f.x = f.hx; f.y = f.hy; f.by = 0; f.t = 0;
      if (p) { p.st.rets++; this.ann(`${p.name} 奪回了${TEAM_NAMES[f.team]}的旗子`, 'FLAG RETURNED', TEAM_COLORS[f.team], 'm'); }
      this.event({ e: 'flag', a: 'ret', team: f.team, id: p ? p.id : 0, x: r1(f.x), y: r1(f.y) });
      this.infoDirty = true;
    }

    capture(p) {
      const o = this.obj;
      const f = o.flags[p.carry];
      p.carry = -1;
      f.st = 0; f.x = f.hx; f.y = f.hy; f.by = 0;
      o.caps[p.team]++;
      p.score++; p.st.caps++;
      this.event({ e: 'flag', a: 'cap', team: f.team, id: p.id, x: r1(p.x), y: r1(p.y) });
      this.ann(`🚩 ${p.name} 搶旗得分！`, `${o.caps[0]} : ${o.caps[1]}`, TEAM_COLORS[p.team], 'xl');
      this.infoDirty = true;
      const target = this.settings.target;
      if (o.caps[p.team] >= target) this.endMatch();
      else if (o.caps[p.team] === target - 1 && !o.mp[p.team]) { o.mp[p.team] = true; this.ann(`${TEAM_NAMES[p.team]} 賽點！`, 'MATCH POINT', TEAM_COLORS[p.team], 'l'); }
    }

    // ---- 山丘之王
    updateKOTH(dt) {
      const h = this.obj;
      h.moveT -= dt;
      if (h.moveT <= 0) {
        h.moveT = C.HILL_MOVE;
        if (this.map.hills.length > 1) {
          h.i = (h.i + 1) % this.map.hills.length;
          h.x = this.map.hills[h.i].x; h.y = this.map.hills[h.i].y;
          this.event({ e: 'hill', x: h.x, y: h.y });
          this.ann('山頭移動了！', 'HILL MOVED', '#ffd84d', 'm');
        }
      }
      const inside = [];
      for (const p of this.players.values()) if (p.alive && Math.hypot(p.x - h.x, p.y - h.y) < h.r) inside.push(p);
      h.cont = inside.length > 1;
      h.owner = inside.length === 1 ? inside[0].id : 0;
      if (inside.length !== 1) return;
      const p = inside[0];
      const before = Math.floor(p.score);
      p.score += dt; p.st.hill += dt;
      if (Math.floor(p.score) !== before) this.infoDirty = true;
      const target = this.settings.target;
      if (!p.warned && target >= 30 && p.score >= target - 10) { p.warned = true; this.ann(`${p.name} 快要稱王了！`, 'ALMOST KING', p.color, 'l'); }
      if (p.score >= target) { p.score = target; this.endMatch(); }
    }

    // ---- 縮圈大逃殺
    brStartRound(first) {
      const o = this.obj;
      o.round++;
      o.ph = 'fight';
      o.wait = 0;
      if (!first) {
        this.loadMap();
        this.bullets = []; this.mines = []; this.powerups = []; this.pending = []; this.barrelRespawn = []; this.shells = []; this.drops = [];
        this.supplyT = 2;
        this.broadcastMap();
      }
      // 大逃殺每回合都很短，空投早一點來
      this.dropT = 8 + Math.random() * 5;
      this.puTimer = 3;
      const W = this.map.w * TILE, H = this.map.h * TILE;
      // 最後的圈圈會落在地圖中央附近的某塊空地
      let fx = W / 2, fy = H / 2;
      for (let i = 0; i < 60; i++) {
        const tx = Math.floor(this.map.w / 2 + (Math.random() - 0.5) * 10), ty = Math.floor(this.map.h / 2 + (Math.random() - 0.5) * 6);
        if (!Core.blocksTank(Core.tileAt(this.map, tx, ty))) { fx = tx * TILE + TILE / 2; fy = ty * TILE + TILE / 2; break; }
      }
      const r0 = Math.hypot(W / 2, H / 2) + 30;
      o.z = { cx: W / 2, cy: H / 2, r: r0, sx: W / 2, sy: H / 2, sr: r0, tx: 0, ty: 0, tr: 0, fx, fy, stage: 0, phase: 'wait', t: BR_STAGES[0].wait };
      this.brTarget();
      for (const p of this.players.values()) { p.alive = false; p.out = false; p.carry = -1; p.air = 0; }
      for (const p of this.players.values()) this.spawn(p);
      o.n = this.players.size;
      this.event({ e: 'round', n: o.round });
      if (!first) this.ann(`第 ${o.round} 回合`, `ROUND ${o.round}`, '#ffd84d', 'xl');
      if (o.n < 2) this.ann('至少要 2 台坦克才分得出勝負', '房主可以回等待室加電腦', '#aaaaaa', 'm');
      this.infoDirty = true;
    }

    brTarget() {
      const z = this.obj.z, s = BR_STAGES[Math.min(z.stage, BR_STAGES.length - 1)];
      z.tx = z.cx + (z.fx - z.cx) * s.f;
      z.ty = z.cy + (z.fy - z.cy) * s.f;
      z.tr = s.r;
    }

    updateBR(dt) {
      const o = this.obj;
      if (o.ph === 'wait') {
        o.wait -= dt;
        if (o.wait <= 0) this.brStartRound(false);
        return;
      }
      const z = o.z;
      z.t -= dt;
      if (z.phase === 'wait' && z.t <= 0) {
        z.phase = 'shrink'; z.t = BR_STAGES[z.stage].shrink;
        z.sx = z.cx; z.sy = z.cy; z.sr = z.r;
        this.event({ e: 'zone', s: z.stage });
        this.ann('毒圈開始縮小！', 'ZONE CLOSING', '#c77dff', 'm');
      } else if (z.phase === 'shrink') {
        const st = BR_STAGES[z.stage];
        const k = 1 - Math.max(0, z.t) / st.shrink;
        z.cx = z.sx + (z.tx - z.sx) * k; z.cy = z.sy + (z.ty - z.sy) * k; z.r = z.sr + (z.tr - z.sr) * k;
        if (z.t <= 0) {
          z.stage++;
          if (z.stage < BR_STAGES.length) { z.phase = 'wait'; z.t = BR_STAGES[z.stage].wait; this.brTarget(); }
          else { z.phase = 'done'; z.t = 0; }
        }
      }
      const dps = BR_STAGES[Math.min(z.stage, BR_STAGES.length - 1)].dps;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - z.cx, p.y - z.cy) > z.r) {
          p.zoneAcc += dt;
          if (p.zoneAcc >= 0.5) { p.zoneAcc -= 0.5; this.damage(p, dps * 0.5, null, 'zone'); }
        } else p.zoneAcc = 0;
      }
      if (this.state !== 'playing') return;
      const alive = [...this.players.values()].filter((p) => p.alive);
      if (o.n >= 2 ? alive.length <= 1 : alive.length === 0) {
        o.ph = 'wait'; o.wait = 5;
        this.shells = [];
        const w = o.n >= 2 && alive[0];
        if (w) {
          w.score++;
          this.event({ e: 'round', n: o.round, w: w.id });
          this.ann(`🐔 ${w.name} 大吉大利，今晚吃雞！`, 'WINNER WINNER CHICKEN DINNER', w.color, 'xl');
          if (w.score >= this.settings.target) { this.endMatch(); return; }
        } else this.ann(o.n >= 2 ? '同歸於盡！這回合沒有贏家' : '被毒圈收掉了', 'ROUND OVER', '#aaaaaa', 'l');
        this.infoDirty = true;
      }
    }

    // ---- 生存闖關
    updateWaves(dt) {
      const o = this.obj;
      let alive = 0;
      for (const p of this.players.values()) if (p.enemy && p.alive) alive++;
      if (o.st === 'prep') {
        o.t -= dt;
        if (o.t <= 0) this.startWave();
      } else {
        o.spawnT -= dt;
        // 人越少，同時在場上的敵軍越少、出兵越慢（一個人玩不會被圍毆）
        const per = Math.max(1, this.squad());
        const cap = Math.min(MAX_ENEMIES, 2 + Math.ceil(per * 1.6));
        if (o.queue.length && o.spawnT <= 0 && alive < cap) {
          this.addEnemy(o.queue.shift());
          alive++;
          o.spawnT = (o.queue.length > 6 ? 0.8 : 1.4) * (per === 1 ? 1.6 : per === 2 ? 1.2 : 1);
        }
        o.left = o.queue.length + alive;
        if (!o.queue.length && !alive) this.waveCleared();
      }
      if (this.state !== 'playing') return;
      const users = this.lifeUsers();
      if (users.length && users.every((p) => !p.alive && p.out)) this.endMatch('lost');
    }

    // 有真人的時候只有真人會扣生命；全部都是電腦（測試）的時候電腦也會扣
    lifeUsers() {
      const squad = [...this.players.values()].filter((p) => !p.enemy);
      const humans = squad.filter((p) => !p.bot);
      return humans.length ? humans : squad;
    }

    waveSpec(n) {
      const specs = [];
      const boss = n % 5 === 0;
      // 敵軍數量隨波數增加，也隨隊伍人數調整（1 人：第 1 波 2 台、第 10 波 7 台；4 人大約兩倍）
      const per = Math.max(1, this.squad());
      const scale = 0.6 + 0.4 * Math.min(per, 6);
      const count = Math.min(14, Math.round((boss ? 0.4 + n * 0.25 : 1.2 + n * 0.55) * scale));
      for (let i = 0; i < count; i++) {
        const r = Math.random();
        const level = n <= 2 ? 'easy' : n <= 4 ? (r < 0.6 ? 'easy' : 'normal') : n <= 7 ? (r < 0.25 ? 'easy' : r < 0.85 ? 'normal' : 'hard') : n <= 11 ? (r < 0.55 ? 'normal' : 'hard') : (r < 0.25 ? 'normal' : 'hard');
        // 種類：雜兵開輕坦、突擊兵開中坦、菁英開重坦；第 4 波開始有砲兵（自走砲）、第 7 波開始有狙擊兵（驅逐戰車）
        let cls = level === 'easy' ? 'light' : level === 'hard' ? 'heavy' : 'medium';
        const q = Math.random();
        if (n >= 4 && q < 0.14) cls = 'spg';
        else if (n >= 7 && q < 0.26) cls = 'td';
        specs.push({ level, cls, hp: 60 + Math.min(80, n * 6), armor: level === 'hard' && n >= 8 ? 30 : 0 });
      }
      if (boss) specs.unshift({ level: 'boss', boss: true, hp: 380 + 140 * (n / 5 - 1) });
      return specs;
    }

    addEnemy(spec) {
      const cls = spec.boss ? 'heavy' : CLASSES[spec.cls] ? spec.cls : 'medium';
      const e = ENEMY[spec.boss ? 'boss' : cls] || ENEMY.medium;
      const p = this.newPlayer({
        name: e.name, color: e.color, skin: spec.boss ? 'skull' : 'classic', bot: new BotBrain(spec.level), team: 1,
        enemy: true, boss: !!spec.boss, cls, armor: spec.armor || 0,
      });
      this.applyClass(p);
      // 血量隨波數變多，再看坦克種類調整（重坦比較耐打、輕坦比較脆）
      p.maxHp = spec.boss ? spec.hp : Math.round(spec.hp * Math.pow(CLASSES[cls].hp / 100, 0.6));
      if (spec.boss) { p.r = 23; p.spd = 0.72; p.kb = 0.3; }
      else if (spec.level === 'hard') p.spd *= 1.05;
      this.players.set(p.id, p);
      this.spawn(p);
      if (p.boss) {
        this.obj.boss = p.id;
        this.event({ e: 'wave', a: 'boss', n: this.obj.wave });
        this.ann('⚠️ BOSS 出現了！', '重裝魔王', '#c77dff', 'xl');
      }
      this.infoDirty = true;
    }

    startWave() {
      const o = this.obj;
      o.wave++;
      o.st = 'fight';
      o.spawnT = 0.6;
      o.queue = this.waveSpec(o.wave);
      o.left = o.queue.length;
      this.event({ e: 'wave', a: 'start', n: o.wave });
      this.ann(`第 ${o.wave} 波`, o.wave % 5 === 0 ? 'BOSS 來襲！' : `${o.queue.length} 台敵軍來了`, o.wave % 5 === 0 ? '#c77dff' : '#ffb142', 'xl');
      this.infoDirty = true;
    }

    waveCleared() {
      const o = this.obj;
      this.event({ e: 'wave', a: 'clear', n: o.wave });
      if (o.target > 0 && o.wave >= o.target) { this.endMatch('clear'); return; }
      o.st = 'prep';
      o.t = 7;
      o.boss = 0;
      const bonus = o.wave % 2 === 0;
      if (bonus) o.lives++;
      for (const p of this.players.values()) {
        if (p.enemy) continue;
        if (p.out) { p.out = false; p.respawnT = 0.5; }
        else if (p.alive) p.hp = Math.min(p.maxHp, p.hp + 40);
      }
      this.ann(`第 ${o.wave} 波過關！`, bonus ? '生命 +1，大家回血' : '大家回血 +40', '#5cff6e', 'l');
      this.infoDirty = true;
    }

    wavesOnDeath(v) {
      const o = this.obj;
      if (v.enemy) {
        if (v.boss) { o.boss = 0; this.ann('BOSS 被擊敗了！', 'BOSS DOWN', '#5cff6e', 'xl'); }
        return;
      }
      if (!this.lifeUsers().includes(v)) { v.respawnT = 5; return; } // 友軍電腦免費重生
      if (o.lives > 0) {
        o.lives--;
        if (o.lives === 0) this.ann('生命用完了！再死就要等過關才能復活', 'LAST LIFE', '#ff5252', 'm');
      } else {
        v.out = true;
        this.ann('你出局了，撐到隊友過關就能復活', 'WAIT FOR NEXT WAVE', '#aaaaaa', 'm', v.id);
      }
      this.infoDirty = true;
    }

    // ------------------------------------------------------------ 指令
    // 房間設定只有房主能改；換隊、換坦克種類每個人都可以
    command(p, msg) {
      const v = msg.v;
      const s = this.settings;
      if (HOST_ONLY[msg.c] && p.id !== this.hostId) { this.event({ e: 'sys', t: '只有房主可以改房間設定', to: p.id }); return; }
      switch (msg.c) {
        case 'mode':
          // 模式只能在等待室換（主畫面開房時選，或房主回到等待室再換）
          if (!MODES[v] || v === s.mode || this.state !== 'waiting') return;
          s.mode = v;
          s.target = MODES[v].def;
          this.matchTime = v === 'waves' ? Infinity : s.time;
          this.assignTeams(true);
          this.sys(`模式改成「${MODES[v].name}」`);
          break;
        case 'target':
          if (!this.M.targets.includes(v)) return;
          s.target = v;
          if (s.mode === 'waves' && this.obj) this.obj.target = v;
          this.sys(`勝利條件改成 ${v ? v + ' ' + this.M.unit : '無盡'}`);
          break;
        case 'time':
          if (!TIMES.includes(v)) return;
          if (isFinite(this.matchTime)) this.matchTime += v - s.time;
          s.time = v;
          this.sys(`時間限制改成 ${v / 60} 分鐘`);
          break;
        case 'map':
          if (typeof v !== 'number' || v < -1 || v >= MAPS.length) return;
          s.map = v;
          this.sys(`地圖改成「${v < 0 ? '輪替' : MAPS[v].name}」`);
          if (v >= 0) {
            if (this.state === 'waiting') { this.mapIdx = v; this.loadMap(); this.broadcastMap(); }
            else this.startMatch();
          }
          break;
        case 'players':
          if (!Number.isInteger(v) || v < 1 || v > MAX_PLAYERS) return;
          s.players = v;
          this.checkFull();
          break;
        case 'bots':
          if (!Number.isInteger(v) || v < 0 || v > MAX_PLAYERS - 1) return;
          this.setBots(v);
          break;
        case 'level':
          if (!LEVELS.includes(v)) return;
          s.level = v;
          for (const q of this.allyBots()) q.bot = new BotBrain(v);
          break;
        case 'start':
          if (this.state !== 'waiting') return;
          this.forced = true;
          this.waitT = 3;
          this.sys('房主按下開始！');
          break;
        case 'lobby':
          if (this.state === 'waiting') return;
          this.sys('房主回到等待室，準備換模式或地圖');
          this.enterWaiting();
          break;
        case 'restart':
          if (this.state === 'waiting') return;
          this.sys('房主重新開始了比賽');
          this.startMatch();
          break;
        case 'addbot': {
          if (!LEVELS.includes(v)) return;
          if (this.squad() >= MAX_PLAYERS) return this.event({ e: 'sys', t: '房間已滿（最多 8 台坦克）', to: p.id });
          const b = this.addBot(v);
          if (b && this.isTeam() && s.mode !== 'waves') b.team = this.countTeam(0, b) <= this.countTeam(1, b) ? 0 : 1;
          s.bots = this.allyBots().length;
          break;
        }
        case 'rmbot': {
          const bots = this.allyBots();
          if (bots.length) this.removePlayer(bots[bots.length - 1].id);
          s.bots = this.allyBots().length;
          break;
        }
        case 'team':
          if (!this.isTeam() || s.mode === 'waves') return;
          if (p.carry >= 0) this.dropFlag(p);
          p.team = 1 - p.team;
          if (p.alive) { p.alive = false; p.respawnT = 1; this.mines = this.mines.filter((m) => m.owner !== p.id); }
          this.sys(`${p.name} 換到了${TEAM_NAMES[p.team]}`);
          break;
        case 'cls':
          // 換坦克種類：活著的時候下次重生才生效
          if (!CLASSES[v]) return;
          if (p.alive && this.state === 'playing') {
            p.nextCls = v === p.cls ? null : v;
            if (p.nextCls) this.event({ e: 'sys', t: `下次重生會換成「${CLASSES[v].name}」`, to: p.id });
          } else {
            p.cls = v; p.nextCls = null;
            this.applyClass(p);
          }
          break;
        default:
          return;
      }
      this.infoDirty = true;
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
      return JSON.stringify({ t: 'map', name: this.map.name, idx: this.mapIdx, theme: this.map.theme, w: this.map.w, h: this.map.h, tiles: Core.encodeTiles(this.map.tiles), hp: Core.encodeTiles(this.map.hp), flags: this.map.flags });
    }

    broadcastMap() {
      const msg = this.mapMsg();
      for (const p of this.players.values()) this.send(p, msg);
    }

    infoMsg() {
      const inter = this.state === 'intermission';
      const list = [...this.players.values()];
      return {
        t: 'info', code: this.code, state: this.state, settings: this.settings, mapName: this.map.name, mapIdx: this.mapIdx,
        maps: MAPS.map((m) => m.name), timeLeft: isFinite(this.matchTime) ? Math.max(0, Math.ceil(this.matchTime)) : -1, interT: Math.ceil(this.interT),
        winner: this.winner, teams: this.teamScores(), host: this.hostId,
        wait: this.state === 'waiting' ? { need: this.settings.players, have: this.humans(), t: this.waitT === null ? -1 : r1(Math.max(0, this.waitT)) } : null,
        players: list.map((p) => ({
          id: p.id, name: p.name, color: p.color, team: p.team, k: p.kills, d: p.deaths, st: p.streak, b: p.best, bot: p.bot ? p.bot.level : null,
          sk: p.skin, c: p.cls, nc: p.nextCls, s: Math.floor(p.score), e: p.enemy ? 1 : 0, boss: p.boss ? 1 : 0, out: p.out ? 1 : 0,
        })),
        awards: inter ? this.awards : null,
        stats: inter ? Object.fromEntries(list.filter((p) => !p.enemy).map((p) => [p.id, Object.assign({}, p.st, { hill: Math.floor(p.st.hill), dmg: Math.round(p.st.dmg) })])) : null,
      };
    }

    broadcastInfo() {
      this.infoDirty = false;
      this.lastInfoAt = performance.now();
      const msg = JSON.stringify(this.infoMsg());
      for (const p of this.players.values()) this.send(p, msg);
    }

    // 躲在草叢或隱形中的坦克，敵人要靠很近才看得到（輕坦看得比較遠）；扛旗的人和 BOSS 一定看得到
    hidden(p) { return (p.inBush || p.cloakT > 0) && p.revealT <= 0 && p.carry < 0 && !p.boss; }

    canSee(viewer, p) {
      if (p === viewer) return true;
      if (this.isTeam() && p.team === viewer.team) return true;
      if (!this.hidden(p)) return true;
      return viewer.alive && dist(viewer, p) < (viewer.see || C.BUSH_SEE);
    }

    canSeeMine(viewer, m) {
      if (m.owner === viewer.id || m.arm > 0) return true;
      if (this.isTeam() && m.team === viewer.team) return true;
      return viewer.alive && dist(viewer, m) < (viewer.mineSee || C.MINE_SEE);
    }

    objMsg() {
      const o = this.obj;
      if (!o || o.mode !== this.settings.mode) return null;
      switch (this.settings.mode) {
        case 'ctf': return { f: o.flags.map((f) => [f.st, r1(f.x), r1(f.y), f.by, Math.ceil(f.t)]), c: o.caps };
        case 'koth': return { h: [r1(o.x), r1(o.y), o.r, o.owner, o.cont ? 1 : 0, Math.ceil(o.moveT)] };
        case 'br': {
          const z = o.z;
          let a = 0;
          for (const p of this.players.values()) if (p.alive) a++;
          return { z: [r1(z.cx), r1(z.cy), r1(z.r), r1(z.tx), r1(z.ty), r1(z.tr), Math.ceil(z.t), z.phase === 'shrink' ? 1 : z.phase === 'done' ? 2 : 0, z.stage], n: o.round, a, ph: o.ph === 'wait' ? 1 : 0, w: Math.ceil(o.wait) };
        }
        case 'waves': return { w: o.wave, st: o.st === 'prep' ? 0 : 1, t: Math.ceil(o.t), l: o.lives, e: o.left, b: o.boss, tg: o.target };
      }
      return null;
    }

    broadcast() {
      const tm = Math.round(performance.now());
      const tanks = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const flags = (p.protectT > 0 ? 1 : 0) | (p.shield > 0 ? 2 : 0) | (p.boostT > 0 ? 4 : 0) | (p.rapidT > 0 ? 8 : 0) |
          (p.tripleT > 0 ? 16 : 0) | (p.special === 'rail' ? 32 : 0) | (p.inBush ? 64 : 0) | (p.dashT > 0 ? 128 : 0) |
          (p.flaming ? 256 : 0) | (p.cloakT > 0 ? 512 : 0) | (p.carry >= 0 ? 1024 : 0) | (p.special === 'homing' ? 2048 : 0) |
          (p.special === 'shotgun' ? 4096 : 0) | (p.special === 'flame' ? 8192 : 0) | (p.bounceT > 0 ? 16384 : 0) | (p.boss ? 32768 : 0);
        tanks.push({ p, a: [p.id, r1(p.x), r1(p.y), r2(p.ha), r2(p.ta), Math.ceil(p.hp), flags, Math.ceil(p.shield), p.maxHp, p.r, CLASS_LIST.indexOf(p.cls)] });
      }
      const B = this.bullets.map((b) => [b.id, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.bounces, b.maxB, b.kind, b.owner, b.pl]);
      const P = this.powerups.map((u) => [u.id, u.x, u.y, u.k]);
      const A = [];
      for (const s of this.shells) if (s.t >= 0 && s.tx !== null) A.push([s.id, s.kind, r1(s.x0), r1(s.y0), r1(s.tx), r1(s.ty), r2(s.t), r2(s.T), s.owner, s.r]);
      const D = this.drops.map((d) => [d.id, d.x, d.y, r2(d.t)]);
      const O = this.objMsg();
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
          alive: v.alive, x: v.x, y: v.y, vx: v.vx, vy: v.vy, ha: v.ha, dashT: v.dashT, dashCd: v.dashCd, dcd: v.dcd, slideT: v.slideT, portLock: v.portLock, ack: v.ack,
          hp: Math.ceil(v.hp), maxHp: v.maxHp, r: v.r, spd: v.spd, cls: v.cls, shield: Math.ceil(v.shield || 0),
          ammo: v.ammo, maxAmmo: v.maxAmmo, ammoT: r2(v.ammoT / v.regen), mines: v.mineAmmo, air: v.air || 0,
          sp: v.special, spN: r1(v.specialN || 0), rapidT: r1(v.rapidT), tripleT: r1(v.tripleT), boostT: r1(v.boostT), shieldT: r1(v.shieldT),
          cloakT: r1(v.cloakT || 0), bounceT: r1(v.bounceT || 0), protectT: r1(v.protectT), respawnT: r1(v.respawnT), team: v.team, out: v.out ? 1 : 0, carry: v.carry,
        };
        v.ws.send(JSON.stringify({ t: 's', tm, T: T_, B, M, P, A, D, O, E, you }));
      }
    }
  }

  const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

  // 一條連線（WebSocket 或 WebRTC）對應一個玩家；伺服器與瀏覽器房主共用
  // sock: { send(str), readyState, bufferedAmount }；getRoom(code) 回傳要加入的房間；
  // hasRoom(code)：房間存不存在（「加入房間」找不到的時候要回 noroom，不能自己開一間）
  // join 訊息：{ name, color, skin, cls, room, create?: { mode, map, players, bots, level, target, time }, join?: true }
  function createClient(sock, getRoom, welcomeExtra, hasRoom) {
    let room = null, player = null, pingAt = 0;
    return {
      message(data) {
        let msg = data;
        if (typeof data === 'string') { try { msg = JSON.parse(data); } catch (e) { return; } }
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'join' && !player) {
          const code = clean(msg.room, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TANK';
          if (msg.join && hasRoom && !hasRoom(code)) { sock.send(JSON.stringify({ t: 'noroom', room: code })); return; }
          room = getRoom(code);
          const fresh = !room.hostId;
          player = room.addPlayer({ name: clean(msg.name, 12) || '無名坦克', color: msg.color, skin: msg.skin, cls: msg.cls, ws: sock });
          if (!player) { sock.send(JSON.stringify({ t: 'full' })); room = null; return; }
          room.emptySince = null;
          // 第一個進來的人就是房主，用他帶來的設定開房
          if (fresh) room.applyCreate(msg.create && typeof msg.create === 'object' ? msg.create : {});
          sock.send(JSON.stringify(Object.assign({ t: 'welcome', id: player.id, room: room.code, host: room.hostId === player.id }, welcomeExtra ? welcomeExtra() : {})));
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

  return { Room, COLORS, SKINS, MODES, TEAM_NAMES, TEAM_COLORS, PU_TEXT, MAX_PLAYERS, LEVELS, TIMES, createClient };
});
