/* 客戶端主程式：大廳、連線、輸入、本地預測 + 伺服器校正、內插、HUD */
(() => {
  const { T, C, K } = Core;
  const $ = (id) => document.getElementById(id);
  const COLORS = ['#ff4d4d', '#4da6ff', '#5cff6e', '#ffd84d', '#c77dff', '#ff9f43', '#00e5d4', '#ff6ec7'];
  const TEAM_COLORS = ['#ff5252', '#448aff'];
  const TEAM_NAMES = ['紅隊', '藍隊'];
  const TAUNTS = ['來啊！打我啊！', '哈哈哈哈哈', 'GG 太簡單', '小心腳下 😏', '救命啊！！'];
  const WEAPON = { shell: '💥', rail: '⚡', mine: '💣', barrel: '🛢️', boom: '🔥' };
  const BOT_LV = { easy: '簡單', normal: '普通', hard: '困難' };
  const INTERP = 80;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k, d) => { try { return localStorage.getItem('tb_' + k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tb_' + k, v); } catch {} } };

  const S = {
    ws: null, joined: false, myId: 0, room: '', lan: [], port: 0, map: null,
    info: null, infoAt: 0, players: new Map(),
    snaps: [], clock: null, bullets: { tm: 0, list: [] }, mines: [], pus: [],
    you: null, pred: null, pending: [], seq: 0, smx: 0, smy: 0, wasAlive: false,
    keys: new Set(), mouse: { sx: innerWidth / 2, sy: innerHeight / 2, left: false, right: false }, latch: 0,
    menuOpen: false, tabHeld: false, bubbles: new Map(), recoil: new Map(),
    deadBy: '', ping: 0, lastTick: -1, lastDryToast: 0,
  };

  // ================================================================ 大廳
  let color = store.get('color', COLORS[Math.floor(Math.random() * COLORS.length)]);
  if (!COLORS.includes(color)) color = COLORS[0];
  $('nameInput').value = store.get('name', '');
  const urlRoom = new URLSearchParams(location.search).get('room');
  $('roomInput').value = (urlRoom || store.get('room', 'TANK')).toUpperCase();
  const pick = $('colorPick');
  COLORS.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'sw' + (c === color ? ' on' : '');
    d.style.background = c;
    d.onclick = () => { color = c; pick.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === d)); };
    pick.appendChild(d);
  });
  $('joinBtn').onclick = join;
  for (const id of ['nameInput', 'roomInput']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  if (!$('nameInput').value) $('nameInput').focus();

  function join() {
    if (S.ws) return;
    const name = $('nameInput').value.trim() || '坦克' + Math.floor(Math.random() * 900 + 100);
    const room = ($('roomInput').value.trim() || 'TANK').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TANK';
    store.set('name', name); store.set('color', color); store.set('room', room);
    Sfx.init();
    $('lobbyMsg').textContent = '連線中…';
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    S.ws = ws;
    ws.onopen = () => send({ t: 'join', name, color, room });
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      if (S.joined) $('disconnected').classList.remove('hidden');
      else { $('lobbyMsg').textContent = '連不上伺服器 😢'; S.ws = null; }
    };
  }
  const send = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };

  // ================================================================ 訊息
  function handle(m) {
    switch (m.t) {
      case 'welcome':
        S.joined = true; S.myId = m.id; S.room = m.room; S.lan = m.lan || []; S.port = m.port;
        $('lobby').classList.add('hidden');
        $('hud').classList.remove('hidden');
        history.replaceState(null, '', '?room=' + encodeURIComponent(m.room));
        buildInvite();
        setInterval(() => send({ t: 'p', c: performance.now() }), 2000);
        break;
      case 'full':
        $('lobbyMsg').textContent = '房間已滿（最多 8 人）';
        break;
      case 'map':
        S.map = { w: m.w, h: m.h, tiles: Core.decodeTiles(m.tiles), hp: Core.decodeTiles(m.hp) };
        Render.setMap(S.map);
        S.snaps = []; S.pred = null; S.pending = []; S.wasAlive = false;
        break;
      case 'info':
        S.info = m; S.infoAt = performance.now();
        S.players = new Map(m.players.map((p) => [p.id, p]));
        refreshScoreUI(); refreshMenu();
        break;
      case 's': onSnap(m); break;
      case 'P': S.ping = Math.round(performance.now() - m.c); break;
    }
  }

  function onSnap(m) {
    const now = performance.now();
    const sample = m.tm - now;
    if (S.clock === null || sample > S.clock) S.clock = sample;
    else S.clock += (sample - S.clock) * 0.02;
    const tanks = new Map();
    for (const a of m.T) tanks.set(a[0], { id: a[0], x: a[1], y: a[2], ha: a[3], ta: a[4], hp: a[5], flags: a[6], shield: a[7] });
    S.snaps.push({ tm: m.tm, tanks });
    if (S.snaps.length > 40) S.snaps.shift();
    S.bullets = { tm: m.tm, list: m.B };
    S.mines = m.M;
    S.pus = m.P;
    S.you = m.you;
    for (const e of m.E) onEvent(e);
    reconcile(m.you);
  }

  // 伺服器校正：以伺服器狀態為準，重播還沒被確認的輸入
  function reconcile(y) {
    S.pending = S.pending.filter((p) => p.s > y.ack);
    if (!y.alive) { S.pred = null; S.wasAlive = false; return; }
    const old = S.pred && S.wasAlive ? { x: S.pred.x, y: S.pred.y } : null;
    const dist = S.pred ? S.pred.dist : 0;
    S.pred = { x: y.x, y: y.y, vx: y.vx, vy: y.vy, ha: y.ha, dashT: y.dashT, dashCd: y.dashCd, boost: y.boostT > 0, dist };
    if (S.info && S.info.state === 'playing') for (const p of S.pending) Core.stepTank(S.pred, p.k, C.DT, S.map);
    S.pred.justDashed = false;
    if (old) {
      const dx = old.x - S.pred.x, dy = old.y - S.pred.y;
      if (dx * dx + dy * dy < 80 * 80) { S.smx += dx; S.smy += dy; } else { S.smx = S.smy = 0; }
    } else { S.smx = S.smy = 0; }
    S.wasAlive = true;
  }

  // ================================================================ 事件
  const colorOf = (id) => {
    const p = S.players.get(id);
    if (!p) return '#cccccc';
    return S.info && S.info.settings.mode === 'team' ? TEAM_COLORS[p.team] : p.color;
  };
  const nameOf = (id) => (S.players.get(id) || { name: '???' }).name;
  function myPos() {
    if (S.pred) return { x: S.pred.x, y: S.pred.y };
    if (S.you) return { x: S.you.x, y: S.you.y };
    return { x: 640, y: 400 };
  }

  function onEvent(e) {
    const me = S.myId, fx = Render.fx;
    switch (e.e) {
      case 'shot':
        fx.shot(e.x, e.y, e.a, colorOf(e.id), e.k);
        Sfx.play('shot', e.x, e.y, e.k);
        S.recoil.set(e.id, e.k ? 3 : 6);
        if (e.id === me) fx.shake(e.k ? 0.5 : 1.4);
        break;
      case 'rail':
        fx.rail(e.pts, '#ff6ec7');
        Sfx.play('rail', e.pts[0][0], e.pts[0][1]);
        S.recoil.set(e.id, 9);
        break;
      case 'bnc': fx.bounce(e.x, e.y); Sfx.play('bounce', e.x, e.y); break;
      case 'spark': fx.spark(e.x, e.y, e.b); Sfx.play(e.b ? 'brick' : 'spark', e.x, e.y); break;
      case 'clash': fx.clash(e.x, e.y); Sfx.play('clash', e.x, e.y); break;
      case 'fizzle': fx.fizzle(e.x, e.y); if (!e.s) Sfx.play('fizzle', e.x, e.y); break;
      case 'hit':
        fx.hit(e.x, e.y, e.d, e.s);
        if (e.id === me) { fx.hurt(e.d); Sfx.play('hurt'); }
        else Sfx.play(e.s ? 'shieldHit' : 'hit', e.x, e.y);
        if (e.by === me && e.id !== me) { fx.hitMarker(); Sfx.play('hitConfirm'); }
        break;
      case 'boom': {
        const p = myPos();
        fx.boom(e.x, e.y, e.r, e.k, p.x, p.y);
        Sfx.play('boom', e.x, e.y, e.r / 100);
        break;
      }
      case 'tile':
        S.map.tiles[e.i] = e.v;
        S.map.hp[e.i] = e.hp || 0;
        Render.tileChanged();
        if (e.d === 1) { fx.brick(e.i); Sfx.play('brick', (e.i % S.map.w) * 40 + 20, Math.floor(e.i / S.map.w) * 40 + 20); }
        break;
      case 'kill':
        addKill(e);
        fx.tankDeath(e.x, e.y, colorOf(e.v));
        if (e.v === me) {
          Sfx.play('death');
          S.deadBy = e.self ? '你把自己炸飛了 🤡' : `被 <b style="color:${colorOf(e.k)}">${esc(nameOf(e.k))}</b> ${WEAPON[e.w] || ''} 擊毀`;
        }
        if (e.k === me && e.v !== me) { Sfx.play('kill'); fx.killConfirm(); }
        break;
      case 'ann': queueAnn(e); break;
      case 'pu':
        fx.pickup(e.x, e.y, e.k, e.t);
        Sfx.play('pickup', e.x, e.y);
        if (e.id === me) toast('獲得：' + e.t);
        break;
      case 'puspawn': fx.puSpawn(e.x, e.y, e.k); Sfx.play('puSpawn', e.x, e.y); break;
      case 'mine': {
        const p = myPos();
        if (e.id === me || Math.hypot(p.x - e.x, p.y - e.y) < 260) Sfx.play('mine', e.x, e.y);
        break;
      }
      case 'armed': fx.mineArm(e.x, e.y, colorOf(me)); Sfx.play('armed'); break;
      case 'dash':
        if (e.id !== me) {
          const t = latestTank(e.id);
          fx.dash(e.x, e.y, e.a, t ? { ...t, color: colorOf(e.id) } : null);
          Sfx.play('dash', e.x, e.y);
        }
        break;
      case 'spawn':
        fx.spawn(e.x, e.y, colorOf(e.id));
        if (e.id === me) { Sfx.play('spawn'); S.deadBy = ''; }
        break;
      case 'dry':
        Sfx.play('dry');
        if (performance.now() - S.lastDryToast > 1500) { S.lastDryToast = performance.now(); toast(e.m ? '地雷用完了！等它補充' : '沒砲彈了！等裝填'); }
        break;
      case 'taunt':
        S.bubbles.set(e.id, { text: TAUNTS[e.i] || '', until: performance.now() + 2200 });
        Sfx.play('taunt');
        break;
      case 'sys': addSys(e.t); break;
    }
  }

  function latestTank(id) {
    const s = S.snaps[S.snaps.length - 1];
    return s ? s.tanks.get(id) : null;
  }

  // ================================================================ 輸入
  addEventListener('keydown', (e) => {
    if (!S.joined) return;
    if (e.code === 'Tab') { e.preventDefault(); S.tabHeld = true; refreshScoreUI(); return; }
    if (e.code === 'Escape') { toggleMenu(); return; }
    if (S.menuOpen) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    S.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') S.latch |= K.DASH;
    if (e.code === 'KeyE') S.latch |= K.MINE;
    if (/^Digit[1-5]$/.test(e.code)) send({ t: 'taunt', i: Number(e.code[5]) - 1 });
    if (e.code === 'KeyM') toast(Sfx.toggleSfx() ? '音效：開' : '音效：關');
    if (e.code === 'KeyN') toast(Sfx.toggleMusic() ? '音樂：開' : '音樂：關');
  });
  addEventListener('keyup', (e) => {
    S.keys.delete(e.code);
    if (e.code === 'Tab') { S.tabHeld = false; refreshScoreUI(); }
  });
  addEventListener('blur', () => { S.keys.clear(); S.mouse.left = S.mouse.right = false; S.tabHeld = false; refreshScoreUI(); });
  const canvas = $('game');
  canvas.addEventListener('mousedown', (e) => {
    Sfx.init();
    if (!S.joined || S.menuOpen) return;
    if (e.button === 0) { S.mouse.left = true; S.latch |= K.FIRE; }
    if (e.button === 2) { S.mouse.right = true; S.latch |= K.MINE; }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) S.mouse.left = false;
    if (e.button === 2) S.mouse.right = false;
  });
  addEventListener('mousemove', (e) => { S.mouse.sx = e.clientX; S.mouse.sy = e.clientY; });
  addEventListener('contextmenu', (e) => { if (S.joined) e.preventDefault(); });

  function sampleKeys() {
    if (S.menuOpen) { S.latch = 0; return 0; }
    const k_ = S.keys;
    let k = 0;
    if (k_.has('KeyW') || k_.has('ArrowUp')) k |= K.UP;
    if (k_.has('KeyS') || k_.has('ArrowDown')) k |= K.DOWN;
    if (k_.has('KeyA') || k_.has('ArrowLeft')) k |= K.LEFT;
    if (k_.has('KeyD') || k_.has('ArrowRight')) k |= K.RIGHT;
    if (S.mouse.left) k |= K.FIRE;
    if (S.mouse.right || k_.has('KeyE')) k |= K.MINE;
    if (k_.has('Space') || k_.has('ShiftLeft') || k_.has('ShiftRight')) k |= K.DASH;
    k |= S.latch;
    S.latch = 0;
    return k;
  }
  function mouseWorld() { return Render.toWorld(S.mouse.sx, S.mouse.sy); }
  function aimAngle() {
    const p = S.pred || S.you;
    if (!p) return 0;
    const m = mouseWorld();
    return Math.atan2(m.y - p.y, m.x - p.x);
  }

  // ================================================================ 主迴圈
  let last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!S.joined || !S.map) return;

    acc += dt;
    const batch = [];
    const playing = S.info && S.info.state === 'playing';
    while (acc >= C.DT && batch.length < 6) {
      acc -= C.DT;
      const k = sampleKeys();
      const a = Math.round(aimAngle() * 1000) / 1000;
      const s = ++S.seq;
      batch.push([s, k, a]);
      S.pending.push({ s, k, a });
      if (S.pred && playing) {
        S.pred.boost = S.you && S.you.boostT > 0;
        Core.stepTank(S.pred, k, C.DT, S.map);
        if (S.pred.justDashed) {
          S.pred.justDashed = false;
          Sfx.play('dash');
          Render.fx.dash(S.pred.x, S.pred.y, 0, { ...S.pred, ta: aimAngle(), color: colorOf(S.myId), flags: 0 });
        }
      }
    }
    if (acc > 0.1) acc = 0;
    if (batch.length) send({ t: 'i', l: batch });
    if (S.pending.length > 120) S.pending.splice(0, S.pending.length - 120);

    const decay = Math.exp(-dt * 14);
    S.smx *= decay; S.smy *= decay;
    for (const [id, r] of S.recoil) { const v = r - dt * 40; if (v <= 0) S.recoil.delete(id); else S.recoil.set(id, v); }

    const st = buildState();
    Render.frame(st, dt);
    updateHud();
  }
  requestAnimationFrame(loop);

  function buildState() {
    const me = S.myId;
    const team = S.info && S.info.settings.mode === 'team';
    const myTeam = S.players.get(me) ? S.players.get(me).team : 0;
    const st = { tanks: [], bullets: [], mines: [], powerups: [], bubbles: [], aim: null, dim: S.info && S.info.state !== 'playing', lowHp: S.you && S.you.alive && S.you.hp < 30 };
    const serverNow = performance.now() + (S.clock || 0);
    const rt = serverNow - INTERP;

    const sn = S.snaps;
    let a = null, b = null;
    for (let i = sn.length - 1; i >= 0; i--) if (sn[i].tm <= rt) { a = sn[i]; b = sn[i + 1] || null; break; }
    if (!a && sn.length) a = sn[0];
    const latest = sn[sn.length - 1];
    if (a) {
      const src = b || a;
      const f = b ? Core.clamp((rt - a.tm) / (b.tm - a.tm), 0, 1) : 0;
      for (const [id, tb] of src.tanks) {
        if (id === me) continue;
        const ta = b ? a.tanks.get(id) : null;
        const t = ta && Math.hypot(ta.x - tb.x, ta.y - tb.y) < 80
          ? { ...tb, x: ta.x + (tb.x - ta.x) * f, y: ta.y + (tb.y - ta.y) * f, ha: Core.lerpAngle(ta.ha, tb.ha, f), ta: Core.lerpAngle(ta.ta, tb.ta, f) }
          : { ...tb };
        decorate(t, id, team, myTeam);
        st.tanks.push(t);
      }
    }
    // 自己（預測位置）
    if (S.pred && S.you && S.you.alive) {
      const own = latest && latest.tanks.get(me);
      const t = { id: me, x: S.pred.x + S.smx, y: S.pred.y + S.smy, ha: S.pred.ha, ta: aimAngle(), hp: S.you.hp, shield: S.you.shield, flags: own ? own.flags : 0 };
      decorate(t, me, team, myTeam);
      st.tanks.push(t);
      Sfx.setListener(t.x, t.y);
      const m = mouseWorld();
      st.aim = { x: m.x, y: m.y, from: { x: t.x, y: t.y }, ammo: S.you.ammo, ammoT: S.you.ammoT, maxAmmo: C.MAX_AMMO, rail: S.you.rail > 0, rapid: S.you.rapidT > 0 };
    } else {
      const m = mouseWorld();
      st.aim = { x: m.x, y: m.y };
    }

    // 砲彈：從最新快照往前外插（含反彈），讓畫面上的砲彈不延遲
    const dtB = Core.clamp((serverNow - S.bullets.tm) / 1000, 0, 0.12);
    const bounce = (bb, tx, ty, tt) => { if (tt === T.STEEL && bb.bounces < bb.maxB) { bb.bounces++; return true; } return false; };
    for (const r of S.bullets.list) {
      const bl = { id: r[0], x: r[1], y: r[2], vx: r[3], vy: r[4], bounces: r[5], maxB: r[6], kind: r[7], owner: r[8] };
      if (dtB > 0 && !Core.stepBullet(S.map, bl, dtB, bounce)) continue;
      bl.color = colorOf(bl.owner);
      st.bullets.push(bl);
    }
    for (const r of S.mines) {
      const owner = S.players.get(r[4]);
      st.mines.push({ x: r[1], y: r[2], armed: !!r[3], mine: r[4] === me, team: team && owner && owner.team === myTeam, color: colorOf(r[4]) });
    }
    for (const r of S.pus) st.powerups.push({ id: r[0], x: r[1], y: r[2], k: r[3] });

    const now = performance.now();
    for (const [id, bub] of S.bubbles) {
      if (now > bub.until) { S.bubbles.delete(id); continue; }
      const t = st.tanks.find((q) => q.id === id);
      if (t) st.bubbles.push({ x: t.x, y: t.y, text: bub.text, a: Math.min(1, (bub.until - now) / 300) });
    }
    return st;
  }

  function decorate(t, id, team, myTeam) {
    const p = S.players.get(id);
    t.name = p ? p.name : '';
    t.color = colorOf(id);
    t.me = id === S.myId;
    t.ally = team && p && p.team === myTeam;
    t.teamColor = team && p ? TEAM_COLORS[p.team] : null;
    t.recoil = S.recoil.get(id) || 0;
  }

  // ================================================================ HUD
  const hudCache = {};
  function setHTML(id, html) { if (hudCache[id] !== html) { hudCache[id] = html; $(id).innerHTML = html; } }

  function updateHud() {
    const y = S.you;
    if (!y || !S.info) return;
    const playing = S.info.state === 'playing';
    const hp = Math.max(0, y.alive ? y.hp : 0);
    const fill = $('hpfill');
    fill.style.width = hp + '%';
    fill.className = hp > 60 ? '' : hp > 30 ? 'mid' : 'low';
    $('shieldfill').style.width = Math.min(100, (y.shield / 60) * 100) + '%';
    setHTML('hptext', y.shield > 0 ? `${hp} <span style="color:#7fe3ff">+${y.shield}</span>` : String(hp));

    let ammo = '';
    if (y.rail > 0) for (let i = 0; i < y.rail; i++) ammo += '<div class="pip rail"></div>';
    else if (y.rapidT > 0) ammo = '<div class="pip inf">∞</div>';
    else for (let i = 0; i < C.MAX_AMMO; i++) {
      if (i < y.ammo) ammo += '<div class="pip"></div>';
      else if (i === y.ammo) ammo += `<div class="pip empty loading" style="--p:${Math.round(y.ammoT * 100)}%"></div>`;
      else ammo += '<div class="pip empty"></div>';
    }
    setHTML('ammo', ammo);
    let mines = '';
    const mx = Math.max(C.MINE_BASE, y.mines);
    for (let i = 0; i < mx; i++) mines += `<div class="mpip${i < y.mines ? '' : ' empty'}"></div>`;
    setHTML('mines', mines);
    const dashPct = Math.round((1 - y.dashCd / C.DASH_CD) * 100);
    $('dashfill').style.width = dashPct + '%';
    $('dash').classList.toggle('ready', y.dashCd <= 0);

    const buffs = [];
    if (y.protectT > 0) buffs.push(['無敵', '#ffffff', y.protectT]);
    if (y.rapidT > 0) buffs.push(['狂暴連射', '#ffb142', y.rapidT]);
    if (y.tripleT > 0) buffs.push(['三連發', '#ffd84d', y.tripleT]);
    if (y.boostT > 0) buffs.push(['加速', '#4da6ff', y.boostT]);
    if (y.shieldT > 0 && y.shield > 0) buffs.push(['護盾', '#7fe3ff', y.shieldT]);
    if (y.rail > 0) buffs.push([`雷射砲 x${y.rail}`, '#ff6ec7']);
    setHTML('buffs', buffs.map(([n, c, t]) => `<span class="buff" style="color:${c}">${n}${t ? ' ' + Math.ceil(t) : ''}</span>`).join(''));

    const dead = !y.alive && playing;
    $('deathscreen').classList.toggle('hidden', !dead);
    if (dead) {
      setHTML('deathby', S.deadBy || '被擊毀');
      setHTML('respawn', `${Math.max(0, y.respawnT).toFixed(1)} 秒後重生…`);
    }

    // 計時
    const left = Math.max(0, S.info.timeLeft - (performance.now() - S.infoAt) / 1000);
    const sec = Math.ceil(left);
    setHTML('timer', playing ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '休息');
    $('timer').classList.toggle('urgent', playing && sec <= 30);
    if (playing && sec <= 10 && sec > 0 && sec !== S.lastTick) { S.lastTick = sec; Sfx.play('tick'); }

    setHTML('netinfo', `${S.ping}ms · 房間 ${esc(S.room)}`);
  }

  function refreshScoreUI() {
    const info = S.info;
    if (!info) return;
    const team = info.settings.mode === 'team';
    const list = [...info.players].sort((a, b) => b.k - a.k || a.d - b.d);
    if (team) {
      setHTML('score-left', `<span style="color:${TEAM_COLORS[0]}">${info.teams[0]}</span>`);
      setHTML('score-right', `<span style="color:${TEAM_COLORS[1]}">${info.teams[1]}</span>`);
      setHTML('goal', `${info.mapName} · 團隊先達 ${info.settings.target} 殺`);
    } else {
      setHTML('score-left', ''); setHTML('score-right', '');
      const lead = list[0];
      setHTML('goal', `${esc(info.mapName)} · 先達 ${info.settings.target} 殺${lead && lead.k > 0 ? ` · 領先 <span style="color:${lead.color}">${esc(lead.name)}</span> ${lead.k}` : ''}`);
    }

    const show = S.tabHeld || info.state !== 'playing';
    $('scoreboard').classList.toggle('hidden', !show);
    if (!show) return;
    let head;
    if (info.state !== 'playing' && info.winner) {
      head = `<h2 style="color:${info.winner.color}">${info.winner.name === '平手' ? '平手！' : '🏆 ' + esc(info.winner.name) + ' 獲勝！'}</h2><div class="sb-sub">下一場即將開始…</div>`;
    } else {
      head = `<h2>計分板</h2><div class="sb-sub">${esc(info.mapName)} · ${team ? '紅藍團隊戰' : '個人混戰'} · 先達 ${info.settings.target} 殺</div>`;
    }
    const row = (p) => `<tr class="${p.id === S.myId ? 'me' : ''}"><td><span class="dot" style="background:${team ? TEAM_COLORS[p.team] : p.color}"></span>${esc(p.name)}${p.bot ? `<span class="bot">電腦·${BOT_LV[p.bot]}</span>` : ''}</td><td class="num">${p.k}</td><td class="num">${p.d}</td><td class="num">${p.b}</td></tr>`;
    let body = '';
    if (team) {
      for (const t of [0, 1]) {
        body += `<tr class="teamhead"><td colspan="4" style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]} — ${info.teams[t]} 殺</td></tr>`;
        body += list.filter((p) => p.team === t).map(row).join('');
      }
    } else body = list.map(row).join('');
    setHTML('scoreboard', `${head}<table><tr><th>玩家</th><th class="num">擊殺</th><th class="num">死亡</th><th class="num">最高連殺</th></tr>${body}</table>`);
  }

  // ================================================================ 擊殺訊息、公告
  function feedItem(html, cls) {
    const kf = $('killfeed');
    const d = document.createElement('div');
    d.className = 'kf ' + (cls || '');
    d.innerHTML = html;
    kf.appendChild(d);
    while (kf.children.length > 7) kf.removeChild(kf.firstChild);
    setTimeout(() => d.classList.add('fade'), 6000);
    setTimeout(() => d.remove(), 6600);
  }
  function addKill(e) {
    const nm = (id) => `<span style="color:${colorOf(id)}">${esc(nameOf(id))}</span>`;
    const mine = e.k === S.myId || e.v === S.myId;
    if (e.self) feedItem(`${nm(e.v)}<span class="w">${WEAPON[e.w] || '💀'}</span>自爆了`, mine ? 'mine' : '');
    else feedItem(`${nm(e.k)}<span class="w">${WEAPON[e.w] || '💀'}</span>${nm(e.v)}${e.b ? '<span class="tag">反彈</span>' : ''}${e.f ? '<span class="tag">逼死</span>' : ''}`, mine ? 'mine' : '');
  }
  const addSys = (t) => feedItem(esc(t), 'sys');

  const annQ = [];
  let annBusy = false;
  function queueAnn(e) {
    annQ.push(e);
    if (annQ.length > 4) annQ.splice(0, annQ.length - 4);
    if (!annBusy) nextAnn();
  }
  function nextAnn() {
    const e = annQ.shift();
    if (!e) { annBusy = false; return; }
    annBusy = true;
    const el = document.createElement('div');
    el.className = 'ann ' + (e.z || 'l');
    el.style.color = e.c || '#fff';
    el.innerHTML = `${esc(e.t)}${e.s ? `<span class="sub">${esc(e.s)}</span>` : ''}`;
    $('announce').replaceChildren(el);
    Sfx.play('announce', e.z === 'xl');
    if (e.z === 'xl') Render.fx.shake(4);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(nextAnn, 260);
    }, annQ.length > 1 ? 750 : 1400);
  }

  let toastT = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 1600);
  }

  // ================================================================ 選單
  function toggleMenu(force) {
    S.menuOpen = force === undefined ? !S.menuOpen : force;
    $('menu').classList.toggle('hidden', !S.menuOpen);
    if (S.menuOpen) { S.keys.clear(); S.mouse.left = S.mouse.right = false; refreshMenu(); }
  }
  $('menuBtn').onclick = () => toggleMenu();
  $('menuClose').onclick = () => toggleMenu(false);
  $('menu').addEventListener('mousedown', (e) => { if (e.target.id === 'menu') toggleMenu(false); });
  const cmd = (c, v) => send({ t: 'cmd', c, v });
  $('modeSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => cmd('mode', b.dataset.v)));
  $('teamBtn').onclick = () => cmd('team');
  $('targetSel').onchange = (e) => cmd('target', Number(e.target.value));
  $('timeSel').onchange = (e) => cmd('time', Number(e.target.value));
  $('mapSel').onchange = (e) => cmd('map', Number(e.target.value));
  $('restartBtn').onclick = () => { cmd('restart'); toggleMenu(false); };
  document.querySelectorAll('[data-bot]').forEach((b) => (b.onclick = () => cmd('addbot', b.dataset.bot)));
  $('rmBot').onclick = () => cmd('rmbot');
  $('sfxBtn').onclick = () => { Sfx.toggleSfx(); refreshMenu(); };
  $('musicBtn').onclick = () => { Sfx.toggleMusic(); refreshMenu(); };
  $('leaveBtn').onclick = () => { location.href = location.pathname + '?room=' + encodeURIComponent(S.room); };

  function refreshMenu() {
    const info = S.info;
    if (!info) return;
    $('modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === info.settings.mode));
    $('teamBtn').classList.toggle('hidden', info.settings.mode !== 'team');
    $('targetSel').value = String(info.settings.target);
    $('timeSel').value = String(info.settings.time);
    const ms = $('mapSel');
    const opts = '<option value="-1">🔁 輪替</option>' + info.maps.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    if (ms.dataset.opts !== opts) { ms.innerHTML = opts; ms.dataset.opts = opts; }
    ms.value = String(info.settings.map);
    $('sfxBtn').textContent = '音效：' + (Sfx.sfxOn ? '開' : '關');
    $('musicBtn').textContent = '音樂：' + (Sfx.musicOn ? '開' : '關');
  }

  function buildInvite() {
    const links = [];
    const q = '/?room=' + encodeURIComponent(S.room);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (!local) links.push(location.origin + q);
    for (const ip of S.lan) { const u = `http://${ip}:${S.port}${q}`; if (!links.includes(u)) links.push(u); }
    if (!links.length) links.push(location.origin + q);
    $('inviteLinks').innerHTML = links.map((u) => `<div class="invite-link"><code>${esc(u)}</code><button class="small" data-copy="${esc(u)}">複製</button></div>`).join('') +
      '<div style="font-size:11px;color:#8b96a5">室友要連同一個 Wi-Fi；開這個網址就會進到同一個房間</div>';
    $('inviteLinks').querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => {
      const u = b.dataset.copy;
      const done = () => { b.textContent = '已複製！'; setTimeout(() => (b.textContent = '複製'), 1200); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(u).then(done, () => fallbackCopy(u, done));
      else fallbackCopy(u, done);
    }));
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    ta.remove();
  }

  Render.init(canvas);
  if (/[?&]debug\b/.test(location.search)) window.__tb = S;
})();
