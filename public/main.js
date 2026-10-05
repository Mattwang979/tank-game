/* 客戶端主程式：大廳（開房 / 加入 / 自己玩）、等待室、連線、輸入、本地預測 + 伺服器校正、內插、HUD、結算、成長系統 */
(() => {
  const { C, K, CLASSES, CLASS_LIST } = Core;
  const { MODES, TEAM_NAMES, TEAM_COLORS, LEVELS, TIMES, MAX_PLAYERS } = TBGame;
  const MAP_NAMES = TBMaps.MAPS.map((m) => m.name);
  const $ = (id) => document.getElementById(id);
  const COLORS = TBGame.COLORS;
  const TAUNTS = ['來啊！打我啊！', '哈哈哈哈哈', 'GG 太簡單', '小心腳下 😏', '救命啊！！'];
  const WEAPON = { shell: '💥', rail: '⚡', mine: '💣', barrel: '🛢️', boom: '💀', missile: '🚀', shotgun: '💢', flame: '🔥', zone: '☠️', air: '✈️', arty: '🎇' };
  const BOT_LV = { easy: '簡單', normal: '普通', hard: '困難', boss: 'BOSS' };
  const SPECIAL_NAME = { rail: '雷射砲', homing: '追蹤飛彈', shotgun: '霰彈砲', flame: '火焰燃料' };
  const SPECIAL_MAX = { rail: 3, homing: 3, shotgun: 4, flame: C.FLAME_FUEL };
  const INTERP = 80;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k, d) => { try { return localStorage.getItem('tb_' + k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tb_' + k, v); } catch {} } };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));

  const S = {
    conn: null, connTok: null, hello: null, tryRoom: '', joined: false, role: null, local: false, host: false,
    myId: 0, room: '', lan: [], port: 0, map: null, homes: null,
    info: null, infoAt: 0, players: new Map(),
    snaps: [], clock: null, bullets: { tm: 0, list: [] }, shells: { tm: 0, list: [] }, drops: { tm: 0, list: [] }, mines: [], pus: [], O: null,
    you: null, pred: null, pending: [], seq: 0, smx: 0, smy: 0, wasAlive: false,
    keys: new Set(), mouse: { sx: innerWidth / 2, sy: innerHeight / 2, left: false, right: false }, latch: 0,
    menuOpen: false, tabHeld: false, bubbles: new Map(), recoil: new Map(), burn: new Map(), seenShells: new Set(),
    deadBy: '', ping: 0, lastTick: -1, lastDryToast: 0, flameSfxT: 0, myStreak: 0, lastWhistle: 0, waitSec: -1,
  };
  const settings = { cam: store.get('cam', 'auto'), gfx: store.get('gfx', 'hi'), vib: store.get('vib', '1') === '1', mini: store.get('mini', '1') === '1' };
  const modeKey = () => (S.info ? S.info.settings.mode : 'ffa');
  const M = () => MODES[modeKey()] || MODES.ffa;
  const buzz = (p) => { if (settings.vib && Touch.enabled && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ================================================================ 大廳
  let color = store.get('color', COLORS[Math.floor(Math.random() * COLORS.length)]);
  if (!COLORS.includes(color)) color = COLORS[0];
  const P2P = Net.mode() !== 'ws';
  if (Touch.available) document.body.classList.add('coarse');
  const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
  const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  $('nameInput').value = store.get('name', '');
  // 朋友傳來的邀請連結（?room=XXXX）
  const urlRoom = cleanCode(new URLSearchParams(location.search).get('room'));
  if (urlRoom) {
    $('roomInput').value = urlRoom;
    $('inviteBox').classList.remove('hidden');
    $('inviteTitle').innerHTML = `📨 朋友邀請你加入房間 <b>${esc(urlRoom)}</b>`;
  }
  $('netHint').textContent = P2P ? '開房的人就是房主，遊戲進行中請保持畫面開著' : '連同一個 Wi-Fi，輸入同一個代碼就能加入';
  const pick = $('colorPick');
  COLORS.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'sw' + (c === color ? ' on' : '');
    d.style.background = c;
    d.onclick = () => { color = c; pick.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === d)); drawSkins(); drawClasses(); };
    pick.appendChild(d);
  });

  // ---- 坦克種類
  const BAR_NAMES = ['耐打', '速度', '火力', '射程'];
  const clsPick = $('clsPick');
  CLASS_LIST.forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cls';
    b.dataset.id = id;
    b.innerHTML = `<canvas></canvas><span>${CLASSES[id].short}</span>`;
    b.onclick = () => { Profile.cls = id; drawClasses(); drawSkins(); showClassInfo(); };
    clsPick.appendChild(b);
  });
  function drawClasses() {
    const cur = Profile.cls;
    clsPick.querySelectorAll('.cls').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === cur);
      Render.preview(b.querySelector('canvas'), color, Profile.skin, skinT, b.dataset.id);
    });
  }
  function showClassInfo() {
    const c = CLASSES[Profile.cls];
    $('clsInfo').innerHTML = `<span class="ci-name">${c.name}</span>　${c.desc}` +
      `<div class="ci-bars">${c.bars.map((v, i) => `<div class="ci-bar">${BAR_NAMES[i]}<i><b style="width:${Math.round(v * 20)}%"></b></i></div>`).join('')}</div>`;
  }

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
      drawClasses();
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
      Render.preview(b.querySelector('canvas'), color, id, skinT, Profile.cls);
    });
  }
  // 黃金和彩虹外觀會動，大廳開著的時候慢慢重畫
  setInterval(() => { if (!S.joined && !$('lobby').classList.contains('hidden')) { skinT += 0.12; drawSkins(); drawClasses(); } }, 120);

  function refreshProfileBar() {
    const L = Profile.level;
    $('pfLv').textContent = `Lv ${L.lv}`;
    $('pfXp').style.width = Math.round(L.pct * 100) + '%';
    $('pfXpText').textContent = `${L.cur} / ${L.need} XP`;
  }
  refreshProfileBar();
  drawSkins();
  drawClasses();
  showClassInfo();

  // ---- 生涯
  $('profileBar').onclick = () => { buildCareer(); $('career').classList.remove('hidden'); };
  $('careerClose').onclick = () => $('career').classList.add('hidden');
  $('career').addEventListener('mousedown', (e) => { if (e.target.id === 'career') $('career').classList.add('hidden'); });
  function buildCareer() {
    const d = Profile.data, s = d.stats, L = Profile.level;
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills ? '∞' : '0';
    const cells = [['等級', `Lv ${L.lv}`], ['總經驗', d.xp], ['完成比賽', s.games], ['勝場', s.wins], ['擊殺', s.kills], ['死亡', s.deaths], ['K/D', kd], ['最高連殺', s.bestStreak],
      ['反彈擊殺', s.rico], ['地雷擊殺', s.mineK], ['油桶擊殺', s.barrelK], ['搶旗得分', s.caps], ['山丘稱王', s.kothWins], ['吃雞', s.brWins], ['闖關最佳', s.bestWave ? `第 ${s.bestWave} 波` : '-'], ['擊倒 BOSS', s.bossK],
      ['空襲擊殺', s.airK], ['搶到空投', s.crates], ['自走砲擊殺', s.artyK]];
    const got = Profile.ACH.filter((a) => d.ach[a.id]).length;
    const next = Profile.SKINS.find((x) => x.lv > L.lv);
    $('careerBody').innerHTML =
      `<div class="cr-lv"><b>Lv ${L.lv}</b><span class="pf-bar"><i style="width:${Math.round(L.pct * 100)}%"></i></span><span>${L.cur} / ${L.need} XP${next ? `　·　Lv ${next.lv} 解鎖「${next.name}」外觀` : '　·　外觀全部解鎖了！'}</span></div>` +
      `<div class="cr-grid">${cells.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>` +
      `<h3>成就 ${got} / ${Profile.ACH.length}</h3>` +
      `<div class="ach-grid">${Profile.ACH.map((a) => `<div class="ach ${d.ach[a.id] ? 'got' : ''}"><i>${a.icon}</i><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` +
      '<div class="cr-note">紀錄存在這台裝置的瀏覽器裡，清除網站資料就會不見。</div>';
  }

  // ================================================================ 開房設定（大廳的開房視窗、等待室的房主設定共用）
  // onChange(key, value)：玩家改了某個設定；compact：等待室用的精簡版（模式按鈕不顯示說明）
  function SetupUI(root, onChange, compact) {
    const stepper = (k) => `<div class="stepper" data-k="${k}"><button type="button" data-d="-1">－</button><b></b><button type="button" data-d="1">＋</button></div>`;
    root.innerHTML =
      `<div class="su-label">模式</div>` +
      `<div class="mode-cards${compact ? ' compact' : ''}">${Object.entries(MODES).map(([k, m]) => `<button type="button" data-mode="${k}"><div><i>${m.icon}</i>${m.name}</div><span>${m.desc}</span></button>`).join('')}</div>` +
      '<div class="su-grid">' +
      `<div class="su-item" data-part="players"><div class="su-label">幾個人一起玩 <span class="hint">（含你，人到齊自動開始）</span></div>${stepper('players')}</div>` +
      `<div class="su-item"><div class="su-label" data-part="botlabel">電腦玩家</div><div class="su-row">${stepper('bots')}<div class="seg" data-k="level">${LEVELS.map((l) => `<button type="button" data-v="${l}">${BOT_LV[l]}</button>`).join('')}</div></div></div>` +
      `<div class="su-item"><div class="su-label">地圖</div><select data-k="map"><option value="-1">🔁 每場輪替</option>${MAP_NAMES.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('')}</select></div>` +
      `<div class="su-item"><div class="su-label" data-part="goallabel">勝利條件 · 時間</div><div class="su-row"><select data-k="target"></select><select data-k="time">${TIMES.map((t) => `<option value="${t}">${t / 60} 分鐘</option>`).join('')}</select></div></div>` +
      '</div>';
    const q = (sel) => root.querySelector(sel);
    let cur = null, solo = false;
    const limits = (k) => (k === 'players' ? [2, MAX_PLAYERS] : [0, MAX_PLAYERS - (solo ? 1 : cur.players)]);
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { if (cur && b.dataset.mode !== cur.mode) onChange('mode', b.dataset.mode); }));
    root.querySelectorAll('.stepper').forEach((st) => st.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      if (!cur) return;
      const k = st.dataset.k, [lo, hi] = limits(k);
      const v = clampInt(cur[k] + Number(b.dataset.d), lo, hi);
      if (v !== cur[k]) onChange(k, v);
    })));
    q('[data-k="level"]').querySelectorAll('button').forEach((b) => (b.onclick = () => { if (cur && b.dataset.v !== cur.level) onChange('level', b.dataset.v); }));
    for (const k of ['map', 'target', 'time']) q(`select[data-k="${k}"]`).onchange = (e) => onChange(k, Number(e.target.value));
    return {
      update(s, isSolo) {
        cur = s; solo = !!isSolo;
        const md = MODES[s.mode] || MODES.ffa;
        root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
        q('[data-part="players"]').classList.toggle('hidden', solo);
        for (const k of ['players', 'bots']) {
          const st = q(`.stepper[data-k="${k}"]`), [lo, hi] = limits(k);
          st.querySelector('b').textContent = s[k];
          st.querySelector('[data-d="-1"]').disabled = s[k] <= lo;
          st.querySelector('[data-d="1"]').disabled = s[k] >= hi;
        }
        q('[data-part="botlabel"]').textContent = s.mode === 'waves' ? '友軍電腦（跟你同一隊）' : '電腦玩家';
        q('[data-k="level"]').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.level));
        q('select[data-k="map"]').value = String(s.map);
        const ts = q('select[data-k="target"]');
        const topts = md.targets.map((v) => `<option value="${v}">${v ? `${v} ${md.unit}` : '無盡模式'}</option>`).join('');
        if (ts.dataset.opts !== topts) { ts.innerHTML = topts; ts.dataset.opts = topts; }
        ts.value = String(s.target);
        const tm = q('select[data-k="time"]');
        tm.value = String(s.time);
        tm.classList.toggle('hidden', s.mode === 'waves');
        q('[data-part="goallabel"]').textContent = s.mode === 'waves' ? '撐過幾波就贏' : '勝利條件 · 時間限制';
      },
    };
  }

  const goalText = (s) => {
    const md = MODES[s.mode] || MODES.ffa;
    if (s.mode === 'waves') return s.target ? `撐過 ${s.target} 波` : '無盡模式';
    return `先達 ${s.target} ${md.unit} · ${s.time / 60} 分鐘`;
  };

  let setupKind = 'multi', setup = null;
  const suUI = SetupUI($('suBody'), (k, v) => {
    if (k === 'mode') { setup.mode = v; setup.target = MODES[v].def; } else setup[k] = v;
    if (setupKind === 'multi') setup.bots = Math.min(setup.bots, MAX_PLAYERS - setup.players);
    suUI.update(setup, setupKind === 'solo');
    refreshSetupSummary();
  });
  // 上次開房用的設定（開房、自己玩分開記）
  function loadSetup(kind) {
    let saved = null;
    try { saved = JSON.parse(store.get('setup_' + kind, 'null')); } catch (e) {}
    const s = Object.assign(kind === 'solo'
      ? { mode: 'ffa', target: 10, time: 300, map: -1, players: 1, bots: 3, level: 'normal' }
      : { mode: 'ffa', target: 15, time: 300, map: -1, players: 2, bots: 0, level: 'normal' }, saved && typeof saved === 'object' ? saved : {});
    if (!MODES[s.mode]) s.mode = 'ffa';
    if (!MODES[s.mode].targets.includes(s.target)) s.target = MODES[s.mode].def;
    if (!TIMES.includes(s.time)) s.time = 300;
    if (!(Number.isInteger(s.map) && s.map >= -1 && s.map < MAP_NAMES.length)) s.map = -1;
    s.players = kind === 'solo' ? 1 : clampInt(s.players, 2, MAX_PLAYERS);
    s.bots = clampInt(s.bots, 0, MAX_PLAYERS - s.players);
    if (!LEVELS.includes(s.level)) s.level = 'normal';
    return s;
  }
  function openSetup(kind, mode) {
    if (S.conn) return;
    setupKind = kind;
    setup = loadSetup(kind);
    // 「單人練習」用上次的模式（上次是闖關的話改回混戰）；「生存闖關」直接選好闖關
    const want = mode || (kind === 'solo' && setup.mode === 'waves' ? 'ffa' : null);
    if (want && want !== setup.mode) { setup.mode = want; setup.target = MODES[want].def; }
    $('setupTitle').textContent = kind === 'solo' ? '🎯 自己玩（不用網路）' : '👥 開房間';
    $('suGo').textContent = kind === 'solo' ? '開打！' : '建立房間';
    $('lobbyMsg').textContent = '';
    suUI.update(setup, kind === 'solo');
    refreshSetupSummary();
    $('setup').classList.remove('hidden');
  }
  function refreshSetupSummary() {
    const s = setup, md = MODES[s.mode];
    const bots = s.bots ? `＋ <b>${s.bots}</b> 台${s.mode === 'waves' ? '友軍' : ''}電腦（${BOT_LV[s.level]}）` : '';
    let text;
    if (setupKind === 'solo') {
      if (s.mode === 'waves') text = `你${bots ? ' ' + bots : ''}一起擋住一波波敵軍`;
      else text = s.bots ? `你 ${bots}` : '沒有電腦的話只能自己練習走位，建議至少加 1 台';
    } else text = `等 <b>${s.players}</b> 個人到齊就自動開打 ${bots}`;
    $('suSummary').innerHTML = `${md.icon} <b>${md.name}</b>：${text}`;
  }
  $('createBtn').onclick = () => openSetup('multi');
  $('soloBtn').onclick = () => openSetup('solo');
  $('wavesBtn').onclick = () => openSetup('solo', 'waves');
  $('setupClose').onclick = () => $('setup').classList.add('hidden');
  $('setup').addEventListener('mousedown', (e) => { if (e.target.id === 'setup') $('setup').classList.add('hidden'); });
  $('suGo').onclick = () => {
    store.set('setup_' + setupKind, JSON.stringify(setup));
    const create = Object.assign({}, setup, setupKind === 'solo' ? { players: 1 } : {});
    if (setupKind === 'solo') connect({ kind: 'solo', room: 'SOLO', create });
    else connect({ kind: 'create', room: randomCode(), create });
  };
  const joinTyped = () => {
    const code = cleanCode($('roomInput').value);
    if (!code) { $('lobbyMsg').textContent = '請輸入朋友給你的房間代碼'; $('roomInput').focus(); return; }
    connect({ kind: 'join', room: code });
  };
  $('joinBtn').onclick = joinTyped;
  $('inviteJoinBtn').onclick = () => connect({ kind: 'join', room: urlRoom });
  $('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinTyped(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (urlRoom) connect({ kind: 'join', room: urlRoom }); else openSetup('multi'); } });
  if (!$('nameInput').value) $('nameInput').focus();
  addEventListener('keydown', (e) => { if (!S.joined && e.code === 'Escape') { $('setup').classList.add('hidden'); $('career').classList.add('hidden'); } });

  // ================================================================ 連線
  // kind：'create' 開新房間（自己當房主）、'join' 加入朋友的房間、'solo' 單人（不用網路）
  function connect(opts) {
    if (S.conn) return;
    const name = $('nameInput').value.trim() || '坦克' + Math.floor(Math.random() * 900 + 100);
    $('nameInput').value = name;
    store.set('name', name); store.set('color', color);
    S.local = opts.kind === 'solo';
    Sfx.init();
    $('lobbyMsg').textContent = '連線中…';
    if (Touch.available) goFullscreen();
    const tok = {};
    S.connTok = tok;
    const mine = () => S.connTok === tok;
    S.tryRoom = opts.room;
    S.hello = () => {
      const m = { t: 'join', name, color, skin: Profile.skin, cls: Profile.cls, room: S.tryRoom };
      if (opts.create) m.create = opts.create;
      if (opts.kind === 'join') m.join = true;
      send(m);
    };
    const conn = Net.connect(opts.room, {
      onOpen: () => { if (!mine()) return; S.role = conn.role; S.hello(); },
      onMessage: (m) => { if (!mine()) return; try { handle(m); } catch (err) { console.error(err); } },
      onStatus: (text) => { if (!mine()) return; $('lobbyMsg').textContent = text; if (!S.joined && /失敗|連不上/.test(text)) dropConn(); },
      onClose: (reason) => {
        if (!mine()) return;
        if (S.joined) { $('discReason').textContent = reason || '連線中斷了'; $('disconnected').classList.remove('hidden'); }
        else { $('lobbyMsg').textContent = '連不上伺服器 😢'; dropConn(); }
      },
      // 加入的房間不存在
      onNoRoom: () => { if (!mine()) return; dropConn(); noRoom(opts.room); },
      // 開新房間但代碼剛好被別人用了 → 換一個代碼再開
      onTaken: () => { if (!mine()) return; dropConn(); connect(Object.assign({}, opts, { room: randomCode() })); },
    }, { local: S.local, create: opts.kind === 'create', join: opts.kind === 'join' });
    if (mine()) S.conn = conn; else if (conn && conn.close) conn.close();
    if (!conn && mine()) { $('lobbyMsg').textContent = '連線模組載入失敗，請重新整理'; S.connTok = null; }
  }
  // 放棄這條連線（找不到房間、房間滿了…），回到大廳可以再試一次
  function dropConn() {
    const c = S.conn;
    S.conn = null; S.connTok = null; S.hello = null;
    if (c && c.close) c.close();
  }
  function noRoom(code) {
    $('lobbyMsg').innerHTML = `找不到房間 <b>${esc(code)}</b> 😢 可能房主還沒開房、已經關掉，或是代碼打錯了`;
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
        S.joined = true; S.myId = m.id; S.room = m.room; S.lan = m.lan || []; S.port = m.port; S.host = !!m.host;
        $('lobby').classList.add('hidden');
        $('career').classList.add('hidden');
        $('setup').classList.add('hidden');
        $('hud').classList.remove('hidden');
        if (!S.local) history.replaceState(null, '', location.pathname + '?room=' + encodeURIComponent(m.room) + keepParams());
        if (Touch.available) { Touch.enable(); Render.setTouch(true); }
        Render.setCamMode(settings.cam);
        Render.setQuality(settings.gfx === 'hi');
        Render.setMinimap(settings.mini);
        Profile.newSession();
        keepAwake();
        checkRotate();
        buildInvite();
        if (S.local) setTimeout(() => toast('單人模式：按 ⚙ 可以換坦克、加減電腦、換模式'), 1500);
        setInterval(() => send({ t: 'p', c: performance.now() }), 2000);
        break;
      case 'noroom': dropConn(); noRoom(m.room || S.tryRoom); break;
      case 'taken': S.tryRoom = randomCode(); if (S.hello) S.hello(); break; // 區網伺服器：代碼被用了，換一個再開
      case 'full':
        dropConn();
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
        S.host = m.host === S.myId;
        S.players = new Map(m.players.map((p) => [p.id, p]));
        if (m.state === 'playing' && prev && prev !== 'playing') { Profile.newSession(); S.myStreak = 0; }
        if (prev === 'waiting' && m.state === 'playing') { Sfx.play('countdown', true); buzz(60); }
        refreshScoreUI(); refreshMenu(); refreshWaitRoom();
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
    for (const a of m.T) tanks.set(a[0], { id: a[0], x: a[1], y: a[2], ha: a[3], ta: a[4], hp: a[5], flags: a[6], shield: a[7], mh: a[8], r: a[9], cls: CLASS_LIST[a[10]] || 'medium' });
    S.snaps.push({ tm: m.tm, tanks });
    if (S.snaps.length > 40) S.snaps.shift();
    S.bullets = { tm: m.tm, list: m.B };
    S.shells = { tm: m.tm, list: m.A || [] };
    S.drops = { tm: m.tm, list: m.D || [] };
    S.mines = m.M;
    S.pus = m.P;
    S.O = m.O || null;
    S.you = m.you;
    // 新出現的砲彈 / 炸彈：播呼嘯聲
    const ids = new Set();
    for (const r of S.shells.list) { ids.add(r[0]); if (!S.seenShells.has(r[0])) onNewShell(r); }
    S.seenShells = ids;
    for (const e of m.E) onEvent(e);
    reconcile(m.you);
  }

  function onNewShell(r) {
    const [, kind, , , tx, ty, t, T, owner] = r;
    const now = performance.now();
    if (now - S.lastWhistle < 120) return;
    const p = myPos();
    if (kind === 0 && owner !== S.myId && Math.hypot(p.x - tx, p.y - ty) > 420) return;
    S.lastWhistle = now;
    Sfx.play('whistle', tx, ty, Math.max(0.35, T - t));
  }

  // 伺服器校正：以伺服器狀態為準，重播還沒被確認的輸入
  function reconcile(y) {
    S.pending = S.pending.filter((p) => p.s > y.ack);
    if (!y.alive) { S.pred = null; S.wasAlive = false; return; }
    const old = S.pred && S.wasAlive ? { x: S.pred.x, y: S.pred.y } : null;
    const dist = S.pred ? S.pred.dist : 0;
    S.pred = { x: y.x, y: y.y, vx: y.vx, vy: y.vy, ha: y.ha, dashT: y.dashT, dashCd: y.dashCd, dcd: y.dcd, slideT: y.slideT, portLock: y.portLock, boost: y.boostT > 0, spd: y.spd, r: y.r, dist };
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
      case 'shot': {
        // k：0 一般、1 連射、2 追蹤飛彈、3 霰彈、4 自走砲、5 驅逐戰車、6 重坦
        fx.shot(e.x, e.y, e.a, colorOf(e.id), e.k);
        Sfx.play({ 2: 'missile', 3: 'shotgun', 4: 'arty', 5: 'tdShot', 6: 'heavyShot' }[e.k] || 'shot', e.x, e.y, e.k === 1);
        S.recoil.set(e.id, { 1: 3, 3: 8, 4: 9, 5: 8, 6: 7 }[e.k] || 6);
        if (e.id === me) { fx.shake({ 1: 0.5, 3: 3, 4: 2.5, 5: 2, 6: 2.2 }[e.k] || 1.4); if (e.k === 3 || e.k === 4) buzz(25); }
        break;
      }
      case 'plane':
        fx.plane(e.x0, e.y0, e.x1, e.y1, e.T, e.k);
        Sfx.play('plane', (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, e.T);
        break;
      case 'land': fx.land(e.x, e.y); Sfx.play('land', e.x, e.y); break;
      case 'aircall':
        Sfx.play('aircall');
        if (e.id === me) { toast('✈️ 轟炸機出動！炸彈會落在敵人附近'); buzz([30, 30, 30]); }
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
      case 'ann':
        // 觀戰中（大逃殺出局、闖關沒命）不要在畫面中央播擊殺訊息，左上 / 右上的擊殺列表還是看得到
        if (e.k === 'kill' && spectating()) break;
        queueAnn(e);
        break;
      case 'pu':
        fx.pickup(e.x, e.y, e.k, e.t);
        Sfx.play(e.k === 'cloak' ? 'cloak' : 'pickup', e.x, e.y);
        if (e.k === 'cloak') fx.cloak(e.x, e.y);
        if (e.id === me) {
          if (e.k === 'crate') { Profile.crate(); toast(Touch.enabled ? '📦 搶到空投！按 📡 呼叫空襲' : '📦 搶到空投！按 Q 呼叫空襲'); buzz([30, 40, 60]); }
          else { toast('獲得：' + e.t); buzz(20); }
        }
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
  // 出局觀戰中（大逃殺被淘汰、闖關沒命了）
  const spectating = () => !!(S.you && !S.you.alive && S.you.out && S.info && S.info.state === 'playing');
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
    if (e.code === 'KeyQ') S.latch |= K.CALL;
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
  // 自走砲的射程：電腦是自己到滑鼠的距離；手機是瞄準搖桿拉多遠（輕點自動瞄準的話就是到敵人的距離）
  const isArty = () => !!(S.you && S.you.cls === 'spg' && !S.you.sp);
  function artyDist() {
    let d;
    if (Touch.enabled) d = Touch.tapDist != null ? Touch.tapDist : C.ARTY_MIN + Touch.aimMag * (C.ARTY_MAX - C.ARTY_MIN);
    else {
      const p = S.pred || S.you;
      if (!p) return 300;
      const m = mouseWorld();
      d = Math.hypot(m.x - p.x, m.y - p.y);
    }
    return Math.round(Core.clamp(d, C.ARTY_MIN, C.ARTY_MAX));
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
    const ad = isArty() ? artyDist() : 0;
    while (acc >= C.DT && batch.length < 6) {
      acc -= C.DT;
      const k = sampleKeys();
      const a = Math.round(aimAngle() * 1000) / 1000;
      const s = ++S.seq;
      batch.push(ad ? [s, k, a, ad] : [s, k, a]);
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

    tickWait();
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
      const t = { id: me, x: S.pred.x + S.smx, y: S.pred.y + S.smy, ha: S.pred.ha, ta: aimAngle(), hp: y.hp, mh: y.maxHp, r: y.r, shield: y.shield, flags: own ? own.flags : 0, cls: y.cls };
      decorate(t, me, team, mt, carriers);
      st.tanks.push(t);
      Sfx.setListener(t.x, t.y);
      const m = Touch.enabled ? { x: t.x + Math.cos(t.ta) * 300, y: t.y + Math.sin(t.ta) * 300 } : mouseWorld();
      const sp = y.sp;
      st.aim = {
        x: m.x, y: m.y, from: { x: t.x, y: t.y }, ammo: y.ammo, ammoT: y.ammoT, maxAmmo: y.maxAmmo || C.MAX_AMMO, rail: sp === 'rail', rapid: y.rapidT > 0,
        special: sp ? { k: sp, n: y.spN, max: SPECIAL_MAX[sp] } : null,
        range: sp === 'shotgun' ? 190 : sp === 'flame' ? C.FLAME_RANGE : 0, arc: sp === 'shotgun' ? C.PELLET_SPREAD : C.FLAME_ARC,
        bounces: y.bounceT > 0 ? 3 : 1, color: sp ? hexA(Render.PU_COLOR[sp], 0.5) : y.bounceT > 0 ? 'rgba(61,252,255,0.35)' : null,
      };
      if (isArty()) {
        const d = artyDist();
        st.aim.arty = { x: t.x + Math.cos(t.ta) * d, y: t.y + Math.sin(t.ta) * d, ang: t.ta, tri: y.tripleT > 0 };
      }
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
    // 出局（大逃殺 / 闖關沒命）、等待室的時候改看全圖
    Render.setSpectate(!!(y && !y.alive && y.out) || !!(S.info && S.info.state === 'waiting'));
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
    // 自走砲砲彈、空襲炸彈：往前外插一點點；自己和隊友的是橘色，敵人的是紅色
    const dtS = Core.clamp((serverNow - S.shells.tm) / 1000, 0, 0.15);
    st.shells = S.shells.list.map((r) => {
      const owner = S.players.get(r[8]);
      return { id: r[0], kind: r[1], x0: r[2], y0: r[3], tx: r[4], ty: r[5], t: Math.min(r[7], r[6] + dtS), T: r[7], r: r[9], safe: r[8] === me || !!(team && owner && owner.team === mt) };
    });
    const dtD = Core.clamp((serverNow - S.drops.tm) / 1000, 0, 0.15);
    st.drops = S.drops.list.map((r) => ({ id: r[0], x: r[1], y: r[2], t: Math.max(0, r[3] - dtD) }));

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
    if (S.info && S.info.state === 'playing' && y && y.alive) {
      // 空投箱（掉下來中、已經落地的）
      for (const d of st.drops) pts.push({ x: d.x, y: d.y, icon: '📦', c: '#ffb300' });
      for (const u of st.powerups) if (u.k === 'crate') pts.push({ x: u.x, y: u.y, icon: '📦', c: '#ffb300' });
    }
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
    if (!t.cls) t.cls = p && p.c ? p.c : 'medium';
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
    const maxAmmo = y.maxAmmo || C.MAX_AMMO;
    if (sp === 'flame') ammo = `<div class="fuel"><i style="width:${Math.round((y.spN / SPECIAL_MAX.flame) * 100)}%"></i></div>`;
    else if (sp) for (let i = 0; i < y.spN; i++) ammo += `<div class="pip sp" style="--c:${Render.PU_COLOR[sp]}"></div>`;
    else if (y.rapidT > 0) ammo = '<div class="pip inf">∞</div>';
    else for (let i = 0; i < maxAmmo; i++) {
      if (i < y.ammo) ammo += '<div class="pip"></div>';
      else if (i === y.ammo) ammo += `<div class="pip empty loading" style="--p:${Math.round(Math.min(1, y.ammoT) * 100)}%"></div>`;
      else ammo += '<div class="pip empty"></div>';
    }
    setHTML('ammo', ammo);
    setHTML('ammoLabel', sp ? SPECIAL_NAME[sp] : y.cls === 'spg' ? '砲彈（拋射）' : '砲彈');
    const me = S.players.get(S.myId);
    const cls = CLASSES[y.cls] || CLASSES.medium;
    setHTML('clsLabel', me && me.nc && CLASSES[me.nc] ? `${cls.name} → 下次 ${CLASSES[me.nc].short}` : cls.name);
    let mines = '';
    const mx = Math.max(C.MINE_BASE, y.mines);
    for (let i = 0; i < mx; i++) mines += `<div class="mpip${i < y.mines ? '' : ' empty'}"></div>`;
    setHTML('mines', mines);
    const dashPct = Math.round(Core.clamp(1 - y.dashCd / (y.dcd || C.DASH_CD), 0, 1) * 100);
    $('dashfill').style.width = dashPct + '%';
    $('dash').classList.toggle('ready', y.dashCd <= 0);
    // 空襲（搶到空投才有）
    const air = playing && y.alive ? y.air || 0 : 0;
    $('airBlock').classList.toggle('hidden', !air);
    setHTML('air', '✈️'.repeat(air));
    if (Touch.enabled) {
      setHTML('mineBadge', String(y.mines));
      const bd = $('btnDash');
      bd.classList.toggle('cd', y.dashCd > 0);
      bd.style.background = y.dashCd > 0 ? `conic-gradient(rgba(127,227,255,.35) ${dashPct}%, rgba(10,14,20,.55) 0)` : '';
      $('btnAir').classList.toggle('hidden', !air);
      setHTML('airBadge', String(air));
      setHTML('stickRHint', isArty() ? '拉越遠打越遠<br>放開開砲' : '拖曳瞄準<br>放開開砲');
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
    const spec = dead && !!y.out;
    $('deathscreen').classList.toggle('hidden', !dead);
    // 觀戰的時候死亡畫面縮成下面一小條，把畫面讓出來看別人打
    $('deathscreen').classList.toggle('spec', spec);
    document.body.classList.toggle('spectating', spec);
    if (dead) {
      const O = S.O || {};
      if (y.out && mode === 'br') {
        setHTML('deadTitle', '💀 出局');
        setHTML('deathby', S.deadBy || '');
        setHTML('respawn', O.ph ? `下一回合 ${O.w} 秒後開始…` : `👀 觀戰中 · 還剩 ${O.a || 0} 台`);
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
    const idle = S.info.state === 'waiting' ? '等待中' : '休息';
    if (mode === 'waves') setHTML('timer', playing && O ? (O.w ? `第 ${O.w} 波` : '準備') : idle);
    else setHTML('timer', playing ? fmtTime(sec) : idle);
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

    const inter = info.state === 'intermission';
    $('results').classList.toggle('hidden', !inter);
    if (inter) { buildResults(info, list, md); $('scoreboard').classList.add('hidden'); return; }
    if (info.state === 'waiting') { $('scoreboard').classList.add('hidden'); return; }
    const show = S.tabHeld || S.scoreToggle;
    $('scoreboard').classList.toggle('hidden', !show);
    if (!show) return;
    const head = `<h2>計分板</h2><div class="sb-sub">${map} · ${md.icon} ${md.name} · ${md.desc}</div>`;
    const cols = scoreCols(mode);
    const row = (p) => `<tr class="${p.id === S.myId ? 'me' : ''}${p.out ? ' out' : ''}"><td><span class="dot" style="background:${md.tc ? TEAM_COLORS[p.team] : p.color}"></span>${esc(p.name)}${p.bot ? `<span class="bot">電腦·${BOT_LV[p.bot]}</span>` : ''}<span class="bot">${CLASSES[p.c] ? CLASSES[p.c].short : ''}</span></td>${cols.map((c) => `<td class="num">${c.v(p)}</td>`).join('')}</tr>`;
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
  $('teamBtn').onclick = () => cmd('team');
  $('lobbyBtn').onclick = () => { cmd('lobby'); toggleMenu(false); };
  $('restartBtn').onclick = () => { cmd('restart'); toggleMenu(false); };
  $('addBot').onclick = () => cmd('addbot', (S.info && S.info.settings.level) || 'normal');
  $('rmBot').onclick = () => cmd('rmbot');
  $('sfxBtn').onclick = () => { Sfx.toggleSfx(); refreshMenu(); };
  $('musicBtn').onclick = () => { Sfx.toggleMusic(); refreshMenu(); };
  $('camSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { setCam(b.dataset.v); refreshMenu(); }));
  $('miniBtn').onclick = () => { settings.mini = !settings.mini; store.set('mini', settings.mini ? '1' : '0'); Render.setMinimap(settings.mini); refreshMenu(); };
  $('gfxBtn').onclick = () => { settings.gfx = settings.gfx === 'hi' ? 'lo' : 'hi'; store.set('gfx', settings.gfx); Render.setQuality(settings.gfx === 'hi'); refreshMenu(); };
  $('vibBtn').onclick = () => { settings.vib = !settings.vib; store.set('vib', settings.vib ? '1' : '0'); if (settings.vib) buzz(30); refreshMenu(); };
  const leave = () => { const kp = keepParams(); location.href = location.pathname + (kp ? '?' + kp.slice(1) : ''); };
  $('leaveBtn').onclick = leave;
  function setCam(v) { settings.cam = v; store.set('cam', v); Render.setCamMode(v); }

  // ---- 換坦克種類（選單、等待室、死亡畫面都有一排按鈕）
  function buildClsRow(el) {
    el.innerHTML = CLASS_LIST.map((id) => `<button type="button" data-cls="${id}" title="${CLASSES[id].desc}">${CLASSES[id].short}</button>`).join('');
    el.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); pickClass(b.dataset.cls); }));
  }
  ['menuCls', 'wrCls', 'deadCls'].forEach((id) => buildClsRow($(id)));
  function pickClass(id) {
    if (!CLASSES[id]) return;
    Profile.cls = id;
    cmd('cls', id);
  }
  function refreshClsRows() {
    const p = S.players.get(S.myId);
    const cur = p && p.c ? p.c : Profile.cls, next = p ? p.nc : null;
    document.querySelectorAll('.cls-row [data-cls]').forEach((b) => {
      b.classList.toggle('on', b.dataset.cls === cur);
      b.classList.toggle('next', b.dataset.cls === next);
    });
    setHTML('menuClsNote', next && CLASSES[next] ? `下次重生會換成「${CLASSES[next].name}」` : CLASSES[cur] ? `${CLASSES[cur].name}：${CLASSES[cur].desc}` : '');
  }

  function refreshMenu() {
    const info = S.info;
    if (!info) return;
    const s = info.settings, mode = s.mode, md = MODES[mode] || MODES.ffa;
    setHTML('menuMode', `${md.icon} <b>${md.name}</b> · ${esc(info.mapName)} · ${goalText(s)}`);
    $('teamBtn').classList.toggle('hidden', !(md.team && !md.coop));
    // 房間設定只有房主能改：模式 / 地圖 / 人數要回等待室換（開房的時候在大廳選好）
    $('hostRow').classList.toggle('hidden', !S.host || info.state === 'waiting');
    $('lobbyBtn').textContent = S.local ? '↩ 換模式 / 地圖' : '↩ 回等待室（換模式 / 地圖 / 人數）';
    $('botRow').classList.toggle('hidden', !S.host);
    $('botLabel').textContent = mode === 'waves' ? '友軍電腦' : '電腦玩家';
    const bots = info.players.filter((p) => p.bot && !p.e).length;
    setHTML('botHint', `現在 ${bots} 台 · 難度 ${BOT_LV[s.level] || '普通'}${S.local ? '' : '（朋友進來時，滿 8 台會自動讓位）'}`);
    $('inviteRow').classList.toggle('hidden', S.local);
    $('camSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.cam));
    $('miniBtn').textContent = '小地圖：' + (settings.mini ? '開' : '關');
    $('gfxBtn').textContent = '畫質：' + (settings.gfx === 'hi' ? '高' : '省電');
    $('vibBtn').textContent = '震動：' + (settings.vib ? '開' : '關');
    $('sfxBtn').textContent = '音效：' + (Sfx.sfxOn ? '開' : '關');
    $('musicBtn').textContent = '音樂：' + (Sfx.musicOn ? '開' : '關');
    refreshClsRows();
  }

  // ================================================================ 等待室
  let wrUI = null;
  $('wrLeave').onclick = leave;
  $('wrStart').onclick = () => cmd('start');
  $('wrTeam').onclick = () => cmd('team');
  function refreshWaitRoom() {
    const info = S.info;
    const show = !!info && info.state === 'waiting';
    $('waitroom').classList.toggle('hidden', !show);
    if (!show) return;
    if (!wrUI) wrUI = SetupUI($('wrSetup'), (k, v) => cmd(k, v), true);
    const s = info.settings, md = MODES[s.mode] || MODES.ffa;
    const w = info.wait || { need: s.players, have: 1, t: -1 };
    const solo = S.local || s.players <= 1;
    const list = info.players.filter((p) => !p.e);
    const humans = list.filter((p) => !p.bot);
    const need = solo ? 1 : w.need;
    const full = humans.length >= need;
    setHTML('wrHave', String(humans.length));
    setHTML('wrNeed', String(need));
    setHTML('wrTitle', w.t >= 0 ? '人到齊了，準備開打！' : solo ? '設定好就按「開打」' : full ? '人到齊了！' : `等待朋友加入…（還差 ${need - humans.length} 人）`);
    setHTML('wrMode', `${md.icon} <b>${md.name}</b> · ${s.map >= 0 ? esc(MAP_NAMES[s.map]) : `地圖輪替（第一張：${esc(info.mapName)}）`} · ${goalText(s)}`);
    const tag = (p) => {
      const t = [];
      if (p.id === info.host) t.push('<em class="host">👑<span> 房主</span></em>');
      if (p.bot) t.push(`<em>🤖 ${BOT_LV[p.bot] || ''}</em>`);
      t.push(`<em>${CLASSES[p.c] ? CLASSES[p.c].short : '中坦'}</em>`);
      return t.join('');
    };
    const team = md.team && !md.coop;
    let html = list.map((p) => `<div class="wr-p${p.id === S.myId ? ' me' : ''}"><span class="dot" style="background:${team ? TEAM_COLORS[p.team] : p.color}"></span><span class="nm">${esc(p.name)}${p.id === S.myId ? '（你）' : ''}</span>${tag(p)}${team ? `<span class="team" style="color:${TEAM_COLORS[p.team]}">${TEAM_NAMES[p.team]}</span>` : ''}</div>`).join('');
    for (let i = humans.length; i < need; i++) html += '<div class="wr-p empty">等待加入…</div>';
    setHTML('wrPlayers', html);
    $('wrInvite').classList.toggle('hidden', S.local);
    $('wrHost').classList.toggle('hidden', !S.host);
    $('wrGuest').classList.toggle('hidden', S.host);
    $('wrStart').classList.toggle('hidden', !S.host);
    $('wrStart').disabled = w.t >= 0;
    $('wrStart').textContent = w.t >= 0 ? '準備開打…' : solo ? '▶ 開打！' : full ? '▶ 開始' : '▶ 不等了，現在開始';
    $('wrTeam').classList.toggle('hidden', !team);
    if (S.host) wrUI.update(s, solo);
    refreshClsRows();
  }
  // 倒數：每一幀用最後收到的秒數往下算，每過一秒嗶一聲
  function tickWait() {
    const info = S.info;
    const w = info && info.state === 'waiting' ? info.wait : null;
    if (!w || w.t < 0) {
      if (S.waitSec !== -1) { S.waitSec = -1; $('wrCd').classList.add('hidden'); }
      return;
    }
    const sec = Math.max(1, Math.ceil(w.t - (performance.now() - S.infoAt) / 1000));
    if (sec !== S.waitSec) {
      S.waitSec = sec;
      $('wrCd').textContent = `${sec} 秒後開打！`;
      $('wrCd').classList.remove('hidden');
      Sfx.play('countdown', false);
    }
  }

  function keepParams() {
    // 測試用參數（net / peerhost / touch）要留著
    const q = new URLSearchParams(location.search);
    let out = '';
    for (const k of ['net', 'peerhost', 'touch', 'debug']) if (q.has(k)) out += `&${k}${q.get(k) ? '=' + encodeURIComponent(q.get(k)) : ''}`;
    return out;
  }

  // 邀請連結：選單裡一份、等待室一份
  function buildInvite() {
    if (S.local) {
      $('inviteLinks').innerHTML = '<div style="font-size:12.5px;color:#b7c0cc;line-height:1.6">現在是<b>單人模式</b>，只有你和電腦。<br>想跟朋友一起玩：按下面的「離開房間」回大廳，再按「開房間」。</div>';
      $('wrInvite').innerHTML = '';
      return;
    }
    const links = [];
    const q = '?room=' + encodeURIComponent(S.room) + keepParams();
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    if (!local || P2P) links.push(location.origin + location.pathname + q);
    if (!P2P) for (const ip of S.lan) { const u = `http://${ip}:${S.port}/${q}`; if (!links.includes(u)) links.push(u); }
    if (!links.length) links.push(location.origin + location.pathname + q);
    const canShare = !!navigator.share;
    const rows = links.map((u) => `<div class="invite-link"><code>${esc(u)}</code><button class="small" data-copy="${esc(u)}">複製</button>${canShare ? `<button class="small" data-share="${esc(u)}">分享</button>` : ''}</div>`).join('');
    $('inviteLinks').innerHTML = rows +
      `<div style="font-size:11px;color:#8b96a5">${P2P ? '把連結傳給朋友（LINE、IG 都可以），點開就能玩，手機電腦都行。你是房主的話請不要關掉這個畫面。' : '室友要連同一個 Wi-Fi；開這個網址就會進到同一個房間'}</div>`;
    $('wrInvite').innerHTML = `<div class="wr-code">房間代碼<b>${esc(S.room)}</b>　${P2P ? '把連結傳給朋友，點開就能加入' : '同一個 Wi-Fi 的朋友開下面的網址就能加入'}</div>${rows}`;
    for (const box of [$('inviteLinks'), $('wrInvite')]) {
      box.querySelectorAll('[data-share]').forEach((b) => (b.onclick = () => {
        navigator.share({ title: '坦克大亂鬥', text: `來跟我打坦克！房間 ${S.room}`, url: b.dataset.share }).catch(() => {});
      }));
      box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => {
        const u = b.dataset.copy;
        const done = () => { b.textContent = '已複製！'; setTimeout(() => (b.textContent = '複製'), 1200); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(u).then(done, () => fallbackCopy(u, done));
        else fallbackCopy(u, done);
      }));
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    ta.remove();
  }

  // ---------------- 手機專用按鈕
  // 輕點右半邊：自動瞄準最近的敵人（隔著牆的比較不優先；自走砲不管牆，但要在射程內）
  Touch.autoAim = () => {
    const me = (S.visible || []).find((t) => t.me);
    if (!me) return null;
    const arty = isArty();
    let best = null, bd = Infinity;
    for (const t of S.visible) {
      if (t.me || t.ally) continue;
      const dist = Math.hypot(t.x - me.x, t.y - me.y);
      const d = arty ? dist * (dist > C.ARTY_MAX ? 2 : 1) : dist * (Core.lineClear(S.map, me.x, me.y, t.x, t.y) ? 1 : 3);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return null;
    return { a: Math.atan2(best.y - me.y, best.x - me.x), d: Math.hypot(best.x - me.x, best.y - me.y) };
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
