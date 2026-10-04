/* 客戶端主程式：大廳、連線、輸入、本地預測 + 伺服器校正、內插、HUD、結算、成長系統 */
(() => {
  const { C, K } = Core;
  const { MODES, TEAM_NAMES, TEAM_COLORS } = TBGame;
  const $ = (id) => document.getElementById(id);
  const COLORS = TBGame.COLORS;
  const TAUNTS = ['來啊！打我啊！', '哈哈哈哈哈', 'GG 太簡單', '小心腳下 😏', '救命啊！！'];
  const WEAPON = { shell: '💥', rail: '⚡', mine: '💣', barrel: '🛢️', boom: '💀', missile: '🚀', shotgun: '💢', flame: '🔥', zone: '☠️' };
  const BOT_LV = { easy: '簡單', normal: '普通', hard: '困難', boss: 'BOSS' };
  const SPECIAL_NAME = { rail: '雷射砲', homing: '追蹤飛彈', shotgun: '霰彈砲', flame: '火焰燃料' };
  const SPECIAL_MAX = { rail: 3, homing: 3, shotgun: 4, flame: C.FLAME_FUEL };
  const INTERP = 80;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k, d) => { try { return localStorage.getItem('tb_' + k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tb_' + k, v); } catch {} } };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  const S = {
    conn: null, joined: false, role: null, local: false, myId: 0, room: '', lan: [], port: 0, map: null, homes: null,
    info: null, infoAt: 0, players: new Map(),
    snaps: [], clock: null, bullets: { tm: 0, list: [] }, mines: [], pus: [], O: null,
    you: null, pred: null, pending: [], seq: 0, smx: 0, smy: 0, wasAlive: false,
    keys: new Set(), mouse: { sx: innerWidth / 2, sy: innerHeight / 2, left: false, right: false }, latch: 0,
    menuOpen: false, tabHeld: false, bubbles: new Map(), recoil: new Map(), burn: new Map(),
    deadBy: '', ping: 0, lastTick: -1, lastDryToast: 0, flameSfxT: 0, myStreak: 0, pendingCmds: [],
  };
  const settings = { cam: store.get('cam', 'auto'), gfx: store.get('gfx', 'hi'), vib: store.get('vib', '1') === '1' };
  const modeKey = () => (S.info ? S.info.settings.mode : 'ffa');
  const M = () => MODES[modeKey()] || MODES.ffa;
  const buzz = (p) => { if (settings.vib && Touch.enabled && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ================================================================ 大廳
  let color = store.get('color', COLORS[Math.floor(Math.random() * COLORS.length)]);
  if (!COLORS.includes(color)) color = COLORS[0];
  const P2P = Net.mode() !== 'ws';
  if (Touch.available) document.body.classList.add('coarse');
  const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
  $('nameInput').value = store.get('name', '');
  const urlRoom = new URLSearchParams(location.search).get('room');
  // P2P 房間在公用配對伺服器上，預設給一個隨機代碼避免撞到陌生人
  $('roomInput').value = (urlRoom || (P2P ? randomCode() : store.get('room', 'TANK'))).toUpperCase();
  $('newRoomBtn').onclick = () => { $('roomInput').value = randomCode(); };
  $('netHint').innerHTML = urlRoom
    ? `朋友邀請你加入房間 <b>${esc(urlRoom.toUpperCase())}</b>，按「加入戰鬥！」就進去了`
    : P2P ? '開房後按 ⚙ 把連結傳給朋友，手機電腦點開就能一起玩' : '';
  if (urlRoom) $('joinBtn').textContent = '加入戰鬥！';
  const pick = $('colorPick');
  COLORS.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'sw' + (c === color ? ' on' : '');
    d.style.background = c;
    d.onclick = () => { color = c; pick.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === d)); drawSkins(); };
    pick.appendChild(d);
  });

  // ---- 坦克外觀
  const skinPick = $('skinPick');
  Profile.SKINS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin';
    b.dataset.id = s.id;
    b.innerHTML = `<canvas></canvas><span>${s.name}</span><em>🔒 Lv ${s.lv}</em>`;
    b.onclick = () => {
      if (!Profile.unlocked(s.id)) { $('lobbyMsg').textContent = `「${s.name}」外觀要到 Lv ${s.lv} 才會解鎖，多打幾場吧！`; return; }
      Profile.skin = s.id;
      $('lobbyMsg').textContent = '';
      drawSkins();
    };
    skinPick.appendChild(b);
  });
  let skinT = 0;
  function drawSkins() {
    const cur = Profile.skin;
    skinPick.querySelectorAll('.skin').forEach((b) => {
      const id = b.dataset.id;
      b.classList.toggle('on', id === cur);
      b.classList.toggle('locked', !Profile.unlocked(id));
      Render.preview(b.querySelector('canvas'), color, id, skinT);
    });
  }
  // 黃金和彩虹外觀會動，大廳開著的時候慢慢重畫
  setInterval(() => { if (!S.joined && !$('lobby').classList.contains('hidden')) { skinT += 0.12; drawSkins(); } }, 120);

  function refreshProfileBar() {
    const L = Profile.level;
    $('pfLv').textContent = `Lv ${L.lv}`;
    $('pfXp').style.width = Math.round(L.pct * 100) + '%';
    $('pfXpText').textContent = `${L.cur} / ${L.need} XP`;
  }
  refreshProfileBar();
  drawSkins();

  // ---- 生涯
  $('profileBar').onclick = () => { buildCareer(); $('career').classList.remove('hidden'); };
  $('careerClose').onclick = () => $('career').classList.add('hidden');
  $('career').addEventListener('mousedown', (e) => { if (e.target.id === 'career') $('career').classList.add('hidden'); });
  function buildCareer() {
    const d = Profile.data, s = d.stats, L = Profile.level;
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills ? '∞' : '0';
    const cells = [['等級', `Lv ${L.lv}`], ['總經驗', d.xp], ['完成比賽', s.games], ['勝場', s.wins], ['擊殺', s.kills], ['死亡', s.deaths], ['K/D', kd], ['最高連殺', s.bestStreak],
      ['反彈擊殺', s.rico], ['地雷擊殺', s.mineK], ['油桶擊殺', s.barrelK], ['搶旗得分', s.caps], ['山丘稱王', s.kothWins], ['吃雞', s.brWins], ['闖關最佳', s.bestWave ? `第 ${s.bestWave} 波` : '-'], ['擊倒 BOSS', s.bossK]];
    const got = Profile.ACH.filter((a) => d.ach[a.id]).length;
    const next = Profile.SKINS.find((x) => x.lv > L.lv);
    $('careerBody').innerHTML =
      `<div class="cr-lv"><b>Lv ${L.lv}</b><span class="pf-bar"><i style="width:${Math.round(L.pct * 100)}%"></i></span><span>${L.cur} / ${L.need} XP${next ? `　·　Lv ${next.lv} 解鎖「${next.name}」外觀` : '　·　外觀全部解鎖了！'}</span></div>` +
      `<div class="cr-grid">${cells.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>` +
      `<h3>成就 ${got} / ${Profile.ACH.length}</h3>` +
      `<div class="ach-grid">${Profile.ACH.map((a) => `<div class="ach ${d.ach[a.id] ? 'got' : ''}"><i>${a.icon}</i><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` +
      '<div class="cr-note">紀錄存在這台裝置的瀏覽器裡，清除網站資料就會不見。</div>';
  }

  $('joinBtn').onclick = () => join({});
  $('soloBtn').onclick = () => join({ local: true, mode: 'ffa' });
  $('wavesBtn').onclick = () => join({ local: true, mode: 'waves' });
  for (const id of ['nameInput', 'roomInput']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') join({}); });
  if (!$('nameInput').value) $('nameInput').focus();

  function join(opts) {
    if (S.conn) return;
    const name = $('nameInput').value.trim() || '坦克' + Math.floor(Math.random() * 900 + 100);
    S.local = !!opts.local;
    const room = S.local ? 'SOLO' : ($('roomInput').value.trim() || 'TANK').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TANK';
    store.set('name', name); store.set('color', color);
    if (!S.local) store.set('room', room);
    // 單人模式進去之後自動設定
    S.pendingCmds = !S.local ? [] : opts.mode === 'waves' ? [['mode', 'waves']] : [['addbot', 'easy'], ['addbot', 'normal'], ['addbot', 'normal']];
    Sfx.init();
    $('lobbyMsg').textContent = '連線中…';
    if (Touch.available) goFullscreen();
    S.conn = Net.connect(room, {
      onOpen: () => { S.role = S.conn.role; send({ t: 'join', name, color, skin: Profile.skin, room }); },
      onMessage: (m) => { try { handle(m); } catch (err) { console.error(err); } },
      onStatus: (text) => { $('lobbyMsg').textContent = text; if (!S.joined && /失敗|連不上/.test(text)) S.conn = null; },
      onClose: (reason) => {
        if (S.joined) { $('discReason').textContent = reason || '連線中斷了'; $('disconnected').classList.remove('hidden'); }
        else { $('lobbyMsg').textContent = '連不上伺服器 😢'; S.conn = null; }
      },
    }, { local: S.local });
    if (!S.conn) $('lobbyMsg').textContent = '連線模組載入失敗，請重新整理';
  }
  const send = (o) => { if (S.conn) S.conn.send(o); };
  const cmd = (c, v) => send({ t: 'cmd', c, v });

  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
    } catch (e) {}
  }
  let wakeLock = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.joined) { keepAwake(); S.lastMsgAt = performance.now(); } });

  // ================================================================ 訊息
  function handle(m) {
    switch (m.t) {
      case 'welcome':
        S.joined = true; S.myId = m.id; S.room = m.room; S.lan = m.lan || []; S.port = m.port;
        $('lobby').classList.add('hidden');
        $('career').classList.add('hidden');
        $('hud').classList.remove('hidden');
        if (!S.local) history.replaceState(null, '', location.pathname + '?room=' + encodeURIComponent(m.room) + keepParams());
        if (Touch.available) { Touch.enable(); Render.setTouch(true); }
        Render.setCamMode(settings.cam);
        Render.setQuality(settings.gfx === 'hi');
        Profile.newSession();
        keepAwake();
        checkRotate();
        buildInvite();
        for (const [c, v] of S.pendingCmds) cmd(c, v);
        S.pendingCmds = [];
        if (S.local) setTimeout(() => toast('單人模式：按 ⚙ 可以換模式、加減電腦'), 1500);
        else if (S.role === 'host') setTimeout(() => toast('你是房主！按 ⚙ 複製連結邀請朋友（請保持這個畫面開著）'), 1200);
        setInterval(() => send({ t: 'p', c: performance.now() }), 2000);
        break;
      case 'full':
        $('lobbyMsg').textContent = '房間已滿（最多 8 人）';
        break;
      case 'map':
        S.map = { w: m.w, h: m.h, theme: m.theme, tiles: Core.decodeTiles(m.tiles), hp: Core.decodeTiles(m.hp) };
        S.homes = m.flags || null;
        Render.setMap(S.map);
        S.snaps = []; S.pred = null; S.pending = []; S.wasAlive = false;
        break;
      case 'info': {
        const prev = S.info ? S.info.state : null;
        S.info = m; S.infoAt = performance.now();
        S.players = new Map(m.players.map((p) => [p.id, p]));
        if (prev === 'intermission' && m.state === 'playing') { Profile.newSession(); S.myStreak = 0; }
        refreshScoreUI(); refreshMenu();
        break;
      }
      case 's': S.lastMsgAt = performance.now(); onSnap(m); break;
      case 'P': S.ping = Math.round(performance.now() - m.c); break;
    }
  }

  function onSnap(m) {
    const now = performance.now();
    const sample = m.tm - now;
    if (S.clock === null || sample > S.clock) S.clock = sample;
    else S.clock += (sample - S.clock) * 0.02;
    const tanks = new Map();
    for (const a of m.T) tanks.set(a[0], { id: a[0], x: a[1], y: a[2], ha: a[3], ta: a[4], hp: a[5], flags: a[6], shield: a[7], mh: a[8], r: a[9] });
    S.snaps.push({ tm: m.tm, tanks });
    if (S.snaps.length > 40) S.snaps.shift();
    S.bullets = { tm: m.tm, list: m.B };
    S.mines = m.M;
    S.pus = m.P;
    S.O = m.O || null;
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
    S.pred = { x: y.x, y: y.y, vx: y.vx, vy: y.vy, ha: y.ha, dashT: y.dashT, dashCd: y.dashCd, slideT: y.slideT, portLock: y.portLock, boost: y.boostT > 0, spd: y.spd, r: y.r, dist };
    if (S.info && S.info.state === 'playing') for (const p of S.pending) Core.stepTank(S.pred, p.k, C.DT, S.map);
    S.pred.justDashed = false; S.pred.justPorted = null; S.pred.justPadded = false;
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
    return M().tc ? TEAM_COLORS[p.team] : p.color;
  };
  const nameOf = (id) => (S.players.get(id) || { name: '???' }).name;
  const myTeam = () => { const p = S.players.get(S.myId); return p ? p.team : 0; };
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
        Sfx.play(e.k === 2 ? 'missile' : e.k === 3 ? 'shotgun' : 'shot', e.x, e.y, e.k === 1);
        S.recoil.set(e.id, e.k === 3 ? 8 : e.k === 1 ? 3 : 6);
        if (e.id === me) { fx.shake(e.k === 3 ? 3 : e.k === 1 ? 0.5 : 1.4); if (e.k === 3) buzz(25); }
        break;
      case 'rail':
        fx.rail(e.segs, '#ff6ec7');
        Sfx.play('rail', e.segs[0][0][0], e.segs[0][0][1]);
        S.recoil.set(e.id, 9);
        break;
      case 'bnc': fx.bounce(e.x, e.y); Sfx.play('bounce', e.x, e.y); break;
      case 'spark': fx.spark(e.x, e.y, e.b); Sfx.play(e.b ? 'brick' : 'spark', e.x, e.y); break;
      case 'clash': fx.clash(e.x, e.y); Sfx.play('clash', e.x, e.y); break;
      case 'fizzle': fx.fizzle(e.x, e.y); if (!e.s) Sfx.play('fizzle', e.x, e.y); break;
      case 'hit':
        if (e.f) {
          // 火焰 / 毒圈是連續小傷害：不要每下都跳數字，合併起來顯示
          fx.hit(e.x, e.y, e.d, e.s, true);
          const b = S.burn.get(e.id) || { d: 0, t: performance.now() };
          b.d += e.d; b.x = e.x; b.y = e.y;
          S.burn.set(e.id, b);
          if (e.id === me) { fx.hurt(e.d * 0.3); buzz(8); }
        } else {
          fx.hit(e.x, e.y, e.d, e.s);
          if (e.id === me) { fx.hurt(e.d); Sfx.play('hurt'); buzz(30); }
          else Sfx.play(e.s ? 'shieldHit' : 'hit', e.x, e.y);
        }
        if (e.by === me && e.id !== me && !e.f) { fx.hitMarker(); Sfx.play('hitConfirm'); }
        break;
      case 'boom': {
        const p = myPos();
        fx.boom(e.x, e.y, e.r, e.k, p.x, p.y);
        Sfx.play('boom', e.x, e.y, e.r / 100);
        if (Math.hypot(p.x - e.x, p.y - e.y) < e.r * 1.5) buzz(40);
        break;
      }
      case 'tile':
        S.map.tiles[e.i] = e.v;
        S.map.hp[e.i] = e.hp || 0;
        Render.tileChanged();
        if (e.d === 1) { fx.brick(e.i); Sfx.play('brick', (e.i % S.map.w) * 40 + 20, Math.floor(e.i / S.map.w) * 40 + 20); }
        break;
      case 'kill': {
        addKill(e);
        const vp = S.players.get(e.v);
        fx.tankDeath(e.x, e.y, colorOf(e.v), vp && vp.boss);
        if (e.v === me) {
          Sfx.play('death');
          buzz([60, 40, 120]);
          S.deadBy = e.self ? '你把自己炸飛了 🤡' : e.zone ? '你被毒圈吞噬了 ☠️' : `被 <b style="color:${colorOf(e.k)}">${esc(nameOf(e.k))}</b> ${WEAPON[e.w] || ''} 擊毀`;
          S.myStreak = 0;
          Profile.death();
        }
        if (e.k === me && e.v !== me) {
          Sfx.play('kill'); fx.killConfirm(); buzz(45);
          const ally = M().team && vp && vp.team === myTeam();
          if (!ally) { S.myStreak++; Profile.kill({ rico: e.b, weapon: e.w, boss: e.boss }); Profile.streak(S.myStreak); }
        }
        break;
      }
      case 'ann': queueAnn(e); break;
      case 'pu':
        fx.pickup(e.x, e.y, e.k, e.t);
        Sfx.play(e.k === 'cloak' ? 'cloak' : 'pickup', e.x, e.y);
        if (e.k === 'cloak') fx.cloak(e.x, e.y);
        if (e.id === me) { toast('獲得：' + e.t); buzz(20); }
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
          fx.dash(e.x, e.y, e.a, t ? { ...t, color: colorOf(e.id), skin: skinOf(e.id) } : null);
          Sfx.play('dash', e.x, e.y);
        }
        break;
      case 'port': if (e.id !== me) { fx.port(e.x, e.y, e.x2, e.y2); Sfx.play('port', e.x2, e.y2); } break;
      case 'pad': if (e.id !== me) Sfx.play('pad', e.x, e.y); break;
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
      case 'flag': {
        const col = TEAM_COLORS[e.team];
        if (e.a === 'take') { fx.flag(e.x, e.y, col); Sfx.play('flagTake'); }
        else if (e.a === 'drop') { fx.flag(e.x, e.y, col); Sfx.play('flagDrop'); }
        else if (e.a === 'ret') { fx.flag(e.x, e.y, col); Sfx.play('flagRet'); if (e.id === me) Profile.returned(); }
        else if (e.a === 'cap') {
          fx.flag(e.x, e.y, TEAM_COLORS[1 - e.team], true); Sfx.play('flagCap'); fx.shake(5);
          if (e.id === me) { Profile.capture(); buzz([40, 30, 80]); }
        }
        break;
      }
      case 'hill': fx.ring(e.x, e.y, '#ffd84d', 110); Sfx.play('horn'); break;
      case 'zone': Sfx.play('siren'); break;
      case 'round': if (e.w) { Sfx.play('flagCap'); if (e.w === me) { Profile.roundWin(); buzz([40, 30, 80]); } } else Sfx.play('horn'); break;
      case 'wave':
        if (e.a === 'start') Sfx.play('horn');
        else if (e.a === 'boss') { Sfx.play('boss'); fx.shake(10); buzz([80, 60, 80]); }
        else if (e.a === 'clear') { Sfx.play('flagCap'); Profile.waveCleared(e.n); }
        break;
      case 'end': onMatchEnd(e.w || {}); break;
      case 'sys': addSys(e.t); break;
    }
  }

  function onMatchEnd(w) {
    const me = S.players.get(S.myId);
    let won = false;
    if (w.coop) won = !w.lost;
    else if (w.team !== undefined) won = !!me && me.team === w.team;
    else won = w.id === S.myId;
    Profile.matchEnd({ won, mode: modeKey(), cleared: w.coop ? w.cleared : 0 });
    if (won) buzz([50, 40, 50, 40, 120]);
  }

  // 升級、解鎖成就
  Profile.on((type, p) => {
    if (!S.joined) return;
    if (type === 'level') {
      queueAnn({ t: `升級！Lv ${p.lv}`, s: p.skins.length ? `解鎖外觀：${p.skins.map((s) => s.name).join('、')}` : 'LEVEL UP', c: '#ffd84d', z: 'l' });
      Sfx.play('levelUp');
      Render.fx.levelUp();
      buzz([30, 30, 30, 30, 90]);
    } else if (type === 'ach') {
      achToast(p);
      Sfx.play('ach');
    }
  });

  function latestTank(id) {
    const s = S.snaps[S.snaps.length - 1];
    return s ? s.tanks.get(id) : null;
  }
  const skinOf = (id) => { const p = S.players.get(id); return p ? p.sk : 'classic'; };

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
    if (e.code === 'KeyC') { const order = ['auto', 'follow', 'fit']; setCam(order[(order.indexOf(settings.cam) + 1) % 3]); toast({ auto: '鏡頭：自動', follow: '鏡頭：跟著我', fit: '鏡頭：看全圖' }[settings.cam]); }
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
    if (Touch.enabled) return;
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
    if (S.menuOpen) { S.latch = 0; if (Touch.enabled) Touch.keys(); return 0; }
    const k_ = S.keys;
    let k = Touch.enabled ? Touch.keys() : 0;
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
    if (Touch.enabled) return Touch.aimAngle;
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
          Render.fx.dash(S.pred.x, S.pred.y, 0, { ...S.pred, ta: aimAngle(), color: colorOf(S.myId), skin: skinOf(S.myId), flags: 0 });
        }
        if (S.pred.justPorted) {
          const [fx_, fy, tx, ty] = S.pred.justPorted;
          S.pred.justPorted = null;
          S.smx = S.smy = 0;
          Render.fx.port(fx_, fy, tx, ty);
          Sfx.play('port');
          buzz(20);
        }
        if (S.pred.justPadded) { S.pred.justPadded = false; Sfx.play('pad'); Render.fx.pad(S.pred.x, S.pred.y, Math.atan2(S.pred.vy, S.pred.vx)); }
      }
    }
    if (acc > 0.1) acc = 0;
    if (batch.length) send({ t: 'i', l: batch });
    if (S.pending.length > 120) S.pending.splice(0, S.pending.length - 120);

    const decay = Math.exp(-dt * 14);
    S.smx *= decay; S.smy *= decay;
    for (const [id, r] of S.recoil) { const v = r - dt * 40; if (v <= 0) S.recoil.delete(id); else S.recoil.set(id, v); }
    // 合併的燃燒傷害數字
    for (const [id, b] of S.burn) {
      if (now - b.t < 450) continue;
      S.burn.delete(id);
      if (b.d > 0) Render.fx.burnText(b.x, b.y, `-${b.d} 🔥`);
    }

    const st = buildState();
    // 火焰噴射聲（不管幾台在噴都只播一個）
    S.flameSfxT -= dt;
    if (S.flameSfxT <= 0) {
      const f = st.tanks.find((t) => t.flags & 256);
      if (f) { Sfx.play('flame', f.x, f.y); S.flameSfxT = 0.13; }
    }
    Render.frame(st, dt);
    updateHud();
  }
  requestAnimationFrame(loop);

  function buildState() {
    const me = S.myId;
    const team = M().team;
    const mt = myTeam();
    const st = { tanks: [], bullets: [], mines: [], powerups: [], bubbles: [], aim: null, dim: S.info && S.info.state !== 'playing', lowHp: S.you && S.you.alive && S.you.hp < S.you.maxHp * 0.3 };
    const serverNow = performance.now() + (S.clock || 0);
    const rt = serverNow - INTERP;
    // 扛旗的人：坦克 id → 被扛的旗子是哪一隊的
    const carriers = new Map();
    if (S.O && S.O.f) S.O.f.forEach((f, t) => { if (f[0] === 1) carriers.set(f[3], t); });

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
        decorate(t, id, team, mt, carriers);
        st.tanks.push(t);
      }
    }
    // 自己（預測位置）
    const y = S.you;
    if (S.pred && y && y.alive) {
      const own = latest && latest.tanks.get(me);
      const t = { id: me, x: S.pred.x + S.smx, y: S.pred.y + S.smy, ha: S.pred.ha, ta: aimAngle(), hp: y.hp, mh: y.maxHp, r: y.r, shield: y.shield, flags: own ? own.flags : 0 };
      decorate(t, me, team, mt, carriers);
      st.tanks.push(t);
      Sfx.setListener(t.x, t.y);
      const m = Touch.enabled ? { x: t.x + Math.cos(t.ta) * 300, y: t.y + Math.sin(t.ta) * 300 } : mouseWorld();
      const sp = y.sp;
      st.aim = {
        x: m.x, y: m.y, from: { x: t.x, y: t.y }, ammo: y.ammo, ammoT: y.ammoT, maxAmmo: C.MAX_AMMO, rail: sp === 'rail', rapid: y.rapidT > 0,
        special: sp ? { k: sp, n: y.spN, max: SPECIAL_MAX[sp] } : null,
        range: sp === 'shotgun' ? 190 : sp === 'flame' ? C.FLAME_RANGE : 0, arc: sp === 'shotgun' ? C.PELLET_SPREAD : C.FLAME_ARC,
        bounces: y.bounceT > 0 ? 3 : 1, color: sp ? hexA(Render.PU_COLOR[sp], 0.5) : y.bounceT > 0 ? 'rgba(61,252,255,0.35)' : null,
      };
      if (Touch.enabled) { st.aim.ringOnly = true; st.aim.noLine = !Touch.aiming; }
      // 鏡頭：跟著自己，稍微往瞄準的方向偏
      let lx = 0, ly = 0;
      if (Touch.enabled) { if (Touch.aiming) { lx = Math.cos(t.ta) * 70; ly = Math.sin(t.ta) * 70; } }
      else { const s = Render.view.s; lx = Core.clamp(((S.mouse.sx - innerWidth / 2) / s) * 0.18, -140, 140); ly = Core.clamp(((S.mouse.sy - innerHeight / 2) / s) * 0.18, -110, 110); }
      st.camTarget = { x: t.x + lx, y: t.y + ly };
    } else if (!Touch.enabled) {
      const m = mouseWorld();
      st.aim = { x: m.x, y: m.y };
    }
    // 出局（大逃殺 / 闖關沒命）的時候改看全圖
    Render.setSpectate(!!(y && !y.alive && y.out));
    S.visible = st.tanks;

    // 砲彈：從最新快照往前外插（含反彈、傳送門），讓畫面上的砲彈不延遲
    const dtB = Core.clamp((serverNow - S.bullets.tm) / 1000, 0, 0.12);
    const bounce = (bb, tx, ty, tt) => { if (tt === Core.T.STEEL && bb.bounces < bb.maxB && bb.kind !== 2) { bb.bounces++; return true; } return false; };
    for (const r of S.bullets.list) {
      const bl = { id: r[0], x: r[1], y: r[2], vx: r[3], vy: r[4], bounces: r[5], maxB: r[6], kind: r[7], owner: r[8], pl: r[9] };
      if (dtB > 0 && !Core.stepBullet(S.map, bl, dtB, bounce)) continue;
      bl.color = colorOf(bl.owner);
      st.bullets.push(bl);
    }
    for (const r of S.mines) {
      const owner = S.players.get(r[4]);
      st.mines.push({ x: r[1], y: r[2], armed: !!r[3], mine: r[4] === me, team: team && owner && owner.team === mt, color: colorOf(r[4]) });
    }
    for (const r of S.pus) st.powerups.push({ id: r[0], x: r[1], y: r[2], k: r[3] });

    const now = performance.now();
    for (const [id, bub] of S.bubbles) {
      if (now > bub.until) { S.bubbles.delete(id); continue; }
      const t = st.tanks.find((q) => q.id === id);
      if (t) st.bubbles.push({ x: t.x, y: t.y, text: bub.text, a: Math.min(1, (bub.until - now) / 300) });
    }

    // 模式目標
    const mode = modeKey();
    st.obj = { mode, O: S.O, homes: S.homes, colorOf, myTeam: mt };
    const pts = [];
    if (S.O && S.info && S.info.state === 'playing') {
      if (mode === 'ctf' && S.O.f) {
        const enemyFlag = S.O.f[1 - mt], ownFlag = S.O.f[mt];
        if (!(enemyFlag[0] === 1 && enemyFlag[3] === me)) pts.push({ x: enemyFlag[1], y: enemyFlag[2], icon: '🚩', c: TEAM_COLORS[1 - mt] });
        if (ownFlag[0] !== 0) pts.push({ x: ownFlag[1], y: ownFlag[2], icon: '⚠️', c: TEAM_COLORS[mt] });
        if (y && y.carry >= 0 && S.homes) pts.push({ x: S.homes[mt].x, y: S.homes[mt].y, icon: '🏠', c: TEAM_COLORS[mt] });
      } else if (mode === 'koth' && S.O.h) pts.push({ x: S.O.h[0], y: S.O.h[1], icon: '⛰️', c: '#ffd84d' });
      else if (mode === 'br' && S.O.z) {
        const [cx, cy, r] = S.O.z;
        const p = st.tanks.find((t) => t.me);
        if (p && Math.hypot(p.x - cx, p.y - cy) > r) { st.inZone = true; pts.push({ x: cx, y: cy, icon: '🟣', c: '#d68cff' }); }
      } else if (mode === 'waves' && S.O.b) {
        const boss = st.tanks.find((t) => t.id === S.O.b);
        if (boss) pts.push({ x: boss.x, y: boss.y, icon: '👹', c: '#c77dff' });
      }
    }
    st.pointers = pts;
    return st;
  }

  function decorate(t, id, team, mt, carriers) {
    const p = S.players.get(id);
    t.name = p ? p.name : '';
    t.color = colorOf(id);
    t.skin = p ? p.sk : 'classic';
    t.me = id === S.myId;
    t.ally = team && p && p.team === mt;
    t.teamColor = M().tc && p ? TEAM_COLORS[p.team] : null;
    t.recoil = S.recoil.get(id) || 0;
    t.boss = !!(t.flags & 32768);
    t.carry = carriers.has(id) ? carriers.get(id) : -1;
  }

  // ================================================================ HUD
  const hudCache = {};
  function setHTML(id, html) { if (hudCache[id] !== html) { hudCache[id] = html; $(id).innerHTML = html; } }

  function updateHud() {
    const y = S.you;
    if (!y || !S.info) return;
    const playing = S.info.state === 'playing';
    const mode = modeKey();
    const maxHp = y.maxHp || C.MAX_HP;
    const hp = Math.max(0, y.alive ? y.hp : 0);
    const pct = (hp / maxHp) * 100;
    const fill = $('hpfill');
    fill.style.width = pct + '%';
    fill.className = pct > 60 ? '' : pct > 30 ? 'mid' : 'low';
    $('shieldfill').style.width = (y.alive ? Math.min(100, (y.shield / 60) * 100) : 0) + '%';
    setHTML('hptext', y.alive && y.shield > 0 ? `${hp} <span style="color:#7fe3ff">+${y.shield}</span>` : String(hp));

    let ammo = '';
    const sp = y.sp;
    if (sp === 'flame') ammo = `<div class="fuel"><i style="width:${Math.round((y.spN / SPECIAL_MAX.flame) * 100)}%"></i></div>`;
    else if (sp) for (let i = 0; i < y.spN; i++) ammo += `<div class="pip sp" style="--c:${Render.PU_COLOR[sp]}"></div>`;
    else if (y.rapidT > 0) ammo = '<div class="pip inf">∞</div>';
    else for (let i = 0; i < C.MAX_AMMO; i++) {
      if (i < y.ammo) ammo += '<div class="pip"></div>';
      else if (i === y.ammo) ammo += `<div class="pip empty loading" style="--p:${Math.round(y.ammoT * 100)}%"></div>`;
      else ammo += '<div class="pip empty"></div>';
    }
    setHTML('ammo', ammo);
    setHTML('ammoLabel', sp ? SPECIAL_NAME[sp] : '砲彈');
    let mines = '';
    const mx = Math.max(C.MINE_BASE, y.mines);
    for (let i = 0; i < mx; i++) mines += `<div class="mpip${i < y.mines ? '' : ' empty'}"></div>`;
    setHTML('mines', mines);
    const dashPct = Math.round((1 - y.dashCd / C.DASH_CD) * 100);
    $('dashfill').style.width = dashPct + '%';
    $('dash').classList.toggle('ready', y.dashCd <= 0);
    if (Touch.enabled) {
      setHTML('mineBadge', String(y.mines));
      const bd = $('btnDash');
      bd.classList.toggle('cd', y.dashCd > 0);
      bd.style.background = y.dashCd > 0 ? `conic-gradient(rgba(127,227,255,.35) ${dashPct}%, rgba(10,14,20,.55) 0)` : '';
    }

    const buffs = [];
    if (y.protectT > 0) buffs.push(['無敵', '#ffffff', y.protectT]);
    if (sp && Touch.enabled) buffs.push([sp === 'flame' ? `火焰 ${Math.ceil(y.spN)}s` : `${SPECIAL_NAME[sp]} x${y.spN}`, Render.PU_COLOR[sp]]);
    if (y.rapidT > 0) buffs.push(['狂暴連射', '#ffb142', y.rapidT]);
    if (y.tripleT > 0 && y.tripleT < 1000) buffs.push(['三連發', '#ffd84d', y.tripleT]);
    if (y.bounceT > 0) buffs.push(['超級反彈', '#3dfcff', y.bounceT]);
    if (y.cloakT > 0) buffs.push(['隱形中', '#b8a6ff', y.cloakT]);
    if (y.boostT > 0) buffs.push(['加速', '#4da6ff', y.boostT]);
    if (y.shieldT > 0 && y.shieldT < 1000 && y.shield > 0) buffs.push(['護盾', '#7fe3ff', y.shieldT]);
    if (y.carry >= 0) buffs.push(['🚩 扛旗中！快回家', TEAM_COLORS[y.carry]]);
    if (!playing || !y.alive) buffs.length = 0;
    setHTML('buffs', buffs.map(([n, c, t]) => `<span class="buff" style="color:${c}">${n}${t ? ' ' + Math.ceil(t) : ''}</span>`).join(''));

    const dead = !y.alive && playing;
    $('deathscreen').classList.toggle('hidden', !dead);
    if (dead) {
      const O = S.O || {};
      if (y.out && mode === 'br') {
        setHTML('deadTitle', '💀 出局了！');
        setHTML('deathby', S.deadBy || '');
        setHTML('respawn', O.ph ? `下一回合 ${O.w} 秒後開始…` : `觀戰中，還剩 ${O.a || 0} 台坦克活著`);
      } else if (y.out && mode === 'waves') {
        setHTML('deadTitle', '💀 生命用完了');
        setHTML('deathby', S.deadBy || '');
        setHTML('respawn', '撐住！隊友打完這一波你就會復活');
      } else {
        setHTML('deadTitle', '💀 被擊毀！');
        setHTML('deathby', S.deadBy || '被擊毀');
        setHTML('respawn', `${Math.max(0, y.respawnT).toFixed(1)} 秒後重生…`);
      }
    }

    // 計時 / 波數
    const left = Math.max(0, S.info.timeLeft - (performance.now() - S.infoAt) / 1000);
    const sec = Math.ceil(left);
    const O = S.O;
    if (mode === 'waves') setHTML('timer', playing && O ? (O.w ? `第 ${O.w} 波` : '準備') : '休息');
    else setHTML('timer', playing ? fmtTime(sec) : '休息');
    $('timer').classList.toggle('urgent', playing && mode !== 'waves' && sec <= 30);
    if (playing && mode !== 'waves' && sec <= 10 && sec > 0 && sec !== S.lastTick) { S.lastTick = sec; Sfx.play('tick'); }
    setHTML('objline', playing ? objLine(mode, O) : '');
    updateBossBar(mode, O);

    setHTML('netinfo', S.local ? '🎯 單人模式（不用網路）' : `${S.role === 'host' ? '👑 你是房主' : S.ping + 'ms'} · 房間 ${esc(S.room)}`);
  }

  function objLine(mode, O) {
    if (!O) return '';
    const me = S.myId;
    if (mode === 'ctf' && O.f) {
      const st = (t) => {
        const [s, , , by, timer] = O.f[t];
        const txt = s === 0 ? '在家' : s === 1 ? (by === me ? '<b>在你手上！</b>' : `被 ${esc(nameOf(by))} 搶走`) : `掉在地上 ${timer}s`;
        return `<span style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]}旗</span> ${txt}`;
      };
      return `${st(0)}　${st(1)}`;
    }
    if (mode === 'koth' && O.h) {
      const [, , , owner, cont, moveT] = O.h;
      const who = owner ? (owner === me ? '<b style="color:#ffd84d">你正在佔領！</b>' : `<span style="color:${colorOf(owner)}">${esc(nameOf(owner))}</span> 佔領中`) : cont ? '<b style="color:#ff5252">爭奪中！</b>' : '山頭沒人佔';
      return `⛰️ ${who} · ${moveT}s 後移動`;
    }
    if (mode === 'br' && O.z) {
      const [, , , , , , t, ph] = O.z;
      if (O.ph) return `第 ${O.n} 回合結束 · 下一回合 ${O.w}s`;
      const zone = ph === 2 ? '最終決戰！' : ph === 1 ? `<b style="color:#d68cff">毒圈縮小中</b> ${t}s` : `毒圈 ${t}s 後縮小`;
      return `第 ${O.n} 回合 · 存活 ${O.a} · ${zone}`;
    }
    if (mode === 'waves') {
      const head = O.st === 0 ? `下一波 <b>${O.t}s</b> 後來襲` : `敵軍剩 <b>${O.e}</b> 台`;
      return `${head} · <span style="color:#ff6b6b">❤</span> 生命 ${O.l}`;
    }
    return '';
  }

  function updateBossBar(mode, O) {
    const bossId = mode === 'waves' && O && S.info.state === 'playing' ? O.b : 0;
    const t = bossId && (S.visible || []).find((q) => q.id === bossId);
    $('bossbar').classList.toggle('hidden', !t);
    if (t) $('bossfill').style.width = Math.max(0, (t.hp / (t.mh || 1)) * 100) + '%';
  }

  function refreshScoreUI() {
    const info = S.info;
    if (!info) return;
    const mode = info.settings.mode;
    const md = MODES[mode] || MODES.ffa;
    const team = md.team && !md.coop;
    const list = info.players.filter((p) => !p.e);
    const scoreKey = mode === 'koth' || mode === 'br' || mode === 'ctf' ? (p) => p.s : (p) => p.k;
    list.sort((a, b) => scoreKey(b) - scoreKey(a) || b.k - a.k || a.d - b.d);
    const tgt = info.settings.target;
    const me = info.players.find((p) => p.id === S.myId);
    if (mode === 'team' || mode === 'ctf') {
      const ic = mode === 'ctf' ? '🚩 ' : '';
      setHTML('score-left', `<span style="color:${TEAM_COLORS[0]}">${ic}${info.teams[0]}</span>`);
      setHTML('score-right', `<span style="color:${TEAM_COLORS[1]}">${info.teams[1]}${ic ? ' 🚩' : ''}</span>`);
    } else { setHTML('score-left', ''); setHTML('score-right', ''); }
    const lead = list[0];
    const map = esc(info.mapName);
    let goal;
    switch (mode) {
      case 'team': goal = `${map} · 團隊先達 ${tgt} 殺`; break;
      case 'ctf': goal = `${map} · 先搶到 ${tgt} 分`; break;
      case 'koth': goal = `${map} · 先佔滿 ${tgt} 秒${me ? ` · 你 ${me.s}s` : ''}${lead && lead.s > 0 && lead !== me ? ` · <span style="color:${lead.color}">${esc(lead.name)}</span> ${lead.s}s` : ''}`; break;
      case 'br': goal = `${map} · 先吃雞 ${tgt} 次${me ? ` · 你 ${me.s} 勝` : ''}`; break;
      case 'waves': goal = `${map} · ${tgt ? `撐過 ${tgt} 波就贏` : '無盡模式'}`; break;
      default: goal = `${map} · 先達 ${tgt} 殺${lead && lead.k > 0 ? ` · 領先 <span style="color:${lead.color}">${esc(lead.name)}</span> ${lead.k}` : ''}`;
    }
    setHTML('goal', goal);

    const inter = info.state !== 'playing';
    $('results').classList.toggle('hidden', !inter);
    if (inter) { buildResults(info, list, md); $('scoreboard').classList.add('hidden'); return; }
    const show = S.tabHeld || S.scoreToggle;
    $('scoreboard').classList.toggle('hidden', !show);
    if (!show) return;
    const head = `<h2>計分板</h2><div class="sb-sub">${map} · ${md.icon} ${md.name} · ${md.desc}</div>`;
    const cols = scoreCols(mode);
    const row = (p) => `<tr class="${p.id === S.myId ? 'me' : ''}${p.out ? ' out' : ''}"><td><span class="dot" style="background:${md.tc ? TEAM_COLORS[p.team] : p.color}"></span>${esc(p.name)}${p.bot ? `<span class="bot">電腦·${BOT_LV[p.bot]}</span>` : ''}</td>${cols.map((c) => `<td class="num">${c.v(p)}</td>`).join('')}</tr>`;
    let body = '';
    if (team) {
      for (const t of [0, 1]) {
        body += `<tr class="teamhead"><td colspan="${cols.length + 1}" style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]} — ${info.teams[t]} ${md.unit}</td></tr>`;
        body += list.filter((p) => p.team === t).map(row).join('');
      }
    } else body = list.map(row).join('');
    setHTML('scoreboard', `${head}<table><tr><th>玩家</th>${cols.map((c) => `<th class="num">${c.h}</th>`).join('')}</tr>${body}</table>`);
  }

  function scoreCols(mode) {
    const k = { h: '擊殺', v: (p) => p.k }, d = { h: '死亡', v: (p) => p.d }, b = { h: '最高連殺', v: (p) => p.b };
    if (mode === 'ctf') return [{ h: '得分', v: (p) => p.s }, k, d];
    if (mode === 'koth') return [{ h: '佔山秒數', v: (p) => p.s }, k, d];
    if (mode === 'br') return [{ h: '吃雞', v: (p) => p.s }, k, d];
    return [k, d, b];
  }

  // ---- 賽後結算
  function buildResults(info, list, md) {
    const w = info.winner || { name: '平手', color: '#fff' };
    const head = w.coop
      ? `<div class="res-head" style="color:${w.color}">${w.lost ? `💀 撐到第 ${w.wave} 波` : '🏆 守住了！'}</div><div class="res-sub">${w.lost ? `過了 ${w.cleared} 波` : `${w.cleared} 波全部擋下來了`}</div>`
      : `<div class="res-head" style="color:${w.color}">${w.name === '平手' ? '平手！' : `🏆 ${esc(w.name)} 獲勝！`}</div>`;
    const awards = (info.awards || []).map((a) => {
      const p = info.players.find((q) => q.id === a.id);
      if (!p) return '';
      return `<div class="award${a.id === S.myId ? ' mine' : ''}"><i>${a.icon}</i><b>${a.t}</b><span style="color:${md.tc ? TEAM_COLORS[p.team] : p.color}">${esc(p.name)}</span><em>${a.v}</em></div>`;
    }).join('');
    const ses = Profile.session, L = Profile.level;
    const lines = ses.lines.map((l) => `<span>${l.why}${l.n > 1 ? ` x${l.n}` : ''} <b>+${l.xp}</b></span>`).join('');
    const lvUp = L.lv > ses.lv0 ? `<span class="lvup">升到 Lv ${L.lv}！</span>` : '';
    const ach = ses.ach.map((a) => `<span class="new-ach">${a.icon} ${a.name}</span>`).join('');
    const mine = `<div class="res-me"><div class="res-xp">+${ses.xp} XP ${lvUp}</div><div class="res-lv"><b>Lv ${L.lv}</b><span class="pf-bar"><i style="width:${Math.round(L.pct * 100)}%"></i></span><em>${L.cur} / ${L.need}</em></div><div class="res-lines">${lines}</div>${ach ? `<div class="res-ach">🏅 新成就：${ach}</div>` : ''}</div>`;
    const stats = info.stats || {};
    const extra = scoreCols(info.settings.mode).slice(0, 1).concat([{ h: '擊殺', v: (p) => p.k }, { h: '死亡', v: (p) => p.d }]).filter((c, i, arr) => arr.findIndex((x) => x.h === c.h) === i);
    const rows = list.map((p) => {
      const s = stats[p.id] || {};
      const acc = s.shots ? Math.round((s.hits / s.shots) * 100) + '%' : '-';
      return `<tr class="${p.id === S.myId ? 'me' : ''}"><td><span class="dot" style="background:${md.tc ? TEAM_COLORS[p.team] : p.color}"></span>${esc(p.name)}${p.bot ? `<span class="bot">電腦</span>` : ''}</td>${extra.map((c) => `<td class="num">${c.v(p)}</td>`).join('')}<td class="num">${acc}</td><td class="num">${s.dmg || 0}</td></tr>`;
    }).join('');
    const table = `<table><tr><th>玩家</th>${extra.map((c) => `<th class="num">${c.h}</th>`).join('')}<th class="num">命中率</th><th class="num">傷害</th></tr>${rows}</table>`;
    setHTML('results', `${head}${awards ? `<div class="res-awards">${awards}</div>` : ''}${mine}${table}<div class="res-next">下一場 ${Math.max(0, info.interT)} 秒後開始…</div>`);
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
    else if (e.zone) feedItem(`${nm(e.v)}<span class="w">☠️</span>被毒圈吞噬`, mine ? 'mine' : '');
    else feedItem(`${nm(e.k)}<span class="w">${WEAPON[e.w] || '💀'}</span>${nm(e.v)}${e.b ? '<span class="tag">反彈</span>' : ''}${e.f ? '<span class="tag">逼死</span>' : ''}${e.boss ? '<span class="tag boss">BOSS</span>' : ''}`, mine ? 'mine' : '');
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
  function achToast(a) {
    const el = document.createElement('div');
    el.className = 'ach-pop';
    el.innerHTML = `<i>${a.icon}</i><div><small>成就解鎖！</small><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`;
    $('hud').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
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
  $('modeGrid').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-v="${k}"><i>${m.icon}</i>${m.name}</button>`).join('');
  $('modeGrid').querySelectorAll('button').forEach((b) => (b.onclick = () => { if (b.dataset.v !== modeKey()) cmd('mode', b.dataset.v); }));
  $('teamBtn').onclick = () => cmd('team');
  $('targetSel').onchange = (e) => cmd('target', Number(e.target.value));
  $('timeSel').onchange = (e) => cmd('time', Number(e.target.value));
  $('mapSel').onchange = (e) => cmd('map', Number(e.target.value));
  $('restartBtn').onclick = () => { cmd('restart'); toggleMenu(false); };
  document.querySelectorAll('[data-bot]').forEach((b) => (b.onclick = () => cmd('addbot', b.dataset.bot)));
  $('rmBot').onclick = () => cmd('rmbot');
  $('sfxBtn').onclick = () => { Sfx.toggleSfx(); refreshMenu(); };
  $('musicBtn').onclick = () => { Sfx.toggleMusic(); refreshMenu(); };
  $('camSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { setCam(b.dataset.v); refreshMenu(); }));
  $('gfxBtn').onclick = () => { settings.gfx = settings.gfx === 'hi' ? 'lo' : 'hi'; store.set('gfx', settings.gfx); Render.setQuality(settings.gfx === 'hi'); refreshMenu(); };
  $('vibBtn').onclick = () => { settings.vib = !settings.vib; store.set('vib', settings.vib ? '1' : '0'); if (settings.vib) buzz(30); refreshMenu(); };
  $('leaveBtn').onclick = () => { location.href = location.pathname + (S.local ? '' : '?room=' + encodeURIComponent(S.room) + keepParams()); };
  function setCam(v) { settings.cam = v; store.set('cam', v); Render.setCamMode(v); }

  function refreshMenu() {
    const info = S.info;
    if (!info) return;
    const mode = info.settings.mode, md = MODES[mode];
    $('modeGrid').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    setHTML('modeDesc', `${md.icon} ${md.desc}`);
    $('teamBtn').classList.toggle('hidden', !(md.team && !md.coop));
    const topts = md.targets.map((v) => `<option value="${v}">${v ? `${v} ${md.unit}` : '無盡'}</option>`).join('');
    const ts = $('targetSel');
    if (ts.dataset.opts !== topts) { ts.innerHTML = topts; ts.dataset.opts = topts; }
    ts.value = String(info.settings.target);
    $('timeSel').value = String(info.settings.time);
    $('timeSel').classList.toggle('hidden', mode === 'waves');
    $('timeLabel').classList.toggle('hidden', mode === 'waves');
    $('botLabel').textContent = mode === 'waves' ? '友軍電腦' : '電腦玩家';
    const ms = $('mapSel');
    const opts = '<option value="-1">🔁 輪替</option>' + info.maps.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    if (ms.dataset.opts !== opts) { ms.innerHTML = opts; ms.dataset.opts = opts; }
    ms.value = String(info.settings.map);
    $('camSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.cam));
    $('gfxBtn').textContent = '畫質：' + (settings.gfx === 'hi' ? '高' : '省電');
    $('vibBtn').textContent = '震動：' + (settings.vib ? '開' : '關');
    $('sfxBtn').textContent = '音效：' + (Sfx.sfxOn ? '開' : '關');
    $('musicBtn').textContent = '音樂：' + (Sfx.musicOn ? '開' : '關');
  }

  function keepParams() {
    // 測試用參數（net / peerhost / touch）要留著
    const q = new URLSearchParams(location.search);
    let out = '';
    for (const k of ['net', 'peerhost', 'touch', 'debug']) if (q.has(k)) out += `&${k}${q.get(k) ? '=' + encodeURIComponent(q.get(k)) : ''}`;
    return out;
  }

  function buildInvite() {
    if (S.local) {
      $('inviteLinks').innerHTML = '<div style="font-size:12.5px;color:#b7c0cc;line-height:1.6">現在是<b>單人模式</b>，只有你和電腦。<br>想跟朋友一起玩：按下面的「離開房間」回大廳，再按「開戰！」開房。</div>';
      return;
    }
    const links = [];
    const q = '?room=' + encodeURIComponent(S.room) + keepParams();
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (!local || P2P) links.push(location.origin + location.pathname + q);
    if (!P2P) for (const ip of S.lan) { const u = `http://${ip}:${S.port}/${q}`; if (!links.includes(u)) links.push(u); }
    if (!links.length) links.push(location.origin + location.pathname + q);
    const canShare = !!navigator.share;
    $('inviteLinks').innerHTML = links.map((u) => `<div class="invite-link"><code>${esc(u)}</code><button class="small" data-copy="${esc(u)}">複製</button>${canShare ? `<button class="small" data-share="${esc(u)}">分享</button>` : ''}</div>`).join('') +
      `<div style="font-size:11px;color:#8b96a5">${P2P ? '把連結傳給朋友（LINE、IG 都可以），點開就能玩，手機電腦都行。你是房主的話請不要關掉這個畫面。' : '室友要連同一個 Wi-Fi；開這個網址就會進到同一個房間'}</div>`;
    $('inviteLinks').querySelectorAll('[data-share]').forEach((b) => (b.onclick = () => {
      navigator.share({ title: '坦克大亂鬥', text: `來跟我打坦克！房間 ${S.room}`, url: b.dataset.share }).catch(() => {});
    }));
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

  // ---------------- 手機專用按鈕
  Touch.autoAim = () => {
    const me = (S.visible || []).find((t) => t.me);
    if (!me) return null;
    let best = null, bd = Infinity;
    for (const t of S.visible) {
      if (t.me || t.ally) continue;
      const d = Math.hypot(t.x - me.x, t.y - me.y) * (Core.lineClear(S.map, me.x, me.y, t.x, t.y) ? 1 : 3);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? Math.atan2(best.y - me.y, best.x - me.x) : null;
  };
  Touch.rapid = () => !!(S.you && (S.you.rapidT > 0 || S.you.sp === 'flame'));
  $('btnScore').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); S.scoreToggle = !S.scoreToggle; refreshScoreUI(); });
  $('scoreboard').addEventListener('pointerdown', () => { if (S.scoreToggle) { S.scoreToggle = false; refreshScoreUI(); } });
  $('tauntMenu').innerHTML = TAUNTS.map((t, i) => `<button data-taunt="${i}">${esc(t)}</button>`).join('');
  $('btnTaunt').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); $('tauntMenu').classList.toggle('hidden'); });
  $('tauntMenu').querySelectorAll('[data-taunt]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    send({ t: 'taunt', i: Number(b.dataset.taunt) });
    $('tauntMenu').classList.add('hidden');
  }));
  // 看門狗：太久沒收到房主 / 伺服器的資料就當作斷線（WebRTC 斷線事件有時候要很久才會觸發）
  setInterval(() => {
    if (S.joined && !S.local && S.lastMsgAt && performance.now() - S.lastMsgAt > 5000 && document.visibilityState === 'visible') {
      $('discReason').textContent = S.role === 'client' ? '房主離線了（可能關掉畫面或網路斷了）' : '連線中斷了';
      $('disconnected').classList.remove('hidden');
    }
  }, 1000);

  function checkRotate() { $('rotate').classList.toggle('hidden', !(Touch.enabled && innerHeight > innerWidth * 1.05)); }
  addEventListener('resize', checkRotate);
  addEventListener('orientationchange', () => setTimeout(() => { checkRotate(); Render.resize(); }, 200));

  Render.init(canvas);
  if (/[?&]debug\b/.test(location.search)) window.__tb = S;
})();
