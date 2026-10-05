/*
 * 成長系統：經驗值、等級、生涯數據、成就、解鎖坦克外觀。
 * 全部存在這台裝置的瀏覽器（localStorage），不需要登入。
 */
const Profile = (() => {
  const KEY = 'tb_profile_v1';

  const SKINS = [
    { id: 'classic', name: '經典', lv: 1 },
    { id: 'camo', name: '迷彩', lv: 2 },
    { id: 'stripe', name: '虎紋', lv: 4 },
    { id: 'bolt', name: '閃電', lv: 6 },
    { id: 'skull', name: '骷髏', lv: 9 },
    { id: 'neon', name: '霓虹', lv: 12 },
    { id: 'gold', name: '黃金', lv: 16 },
    { id: 'rainbow', name: '彩虹', lv: 20 },
  ];

  const ACH = [
    { id: 'blood', icon: '🩸', name: '初次見血', desc: '拿到第一個擊殺', ok: (s) => s.kills >= 1 },
    { id: 'k100', icon: '💯', name: '百人斬', desc: '累積 100 個擊殺', ok: (s) => s.kills >= 100 },
    { id: 'rico', icon: '↩️', name: '反彈大師', desc: '累積 10 次反彈擊殺', ok: (s) => s.rico >= 10 },
    { id: 'mine', icon: '💣', name: '地雷專家', desc: '累積 10 次地雷擊殺', ok: (s) => s.mineK >= 10 },
    { id: 'barrel', icon: '🛢️', name: '爆破狂人', desc: '累積 10 次油桶擊殺', ok: (s) => s.barrelK >= 10 },
    { id: 's5', icon: '🔥', name: '勢不可擋', desc: '一場比賽拿到 5 連殺', ok: (s) => s.bestStreak >= 5 },
    { id: 's10', icon: '👑', name: '如神一般', desc: '一場比賽拿到 10 連殺', ok: (s) => s.bestStreak >= 10 },
    { id: 'win', icon: '🏆', name: '首勝', desc: '贏得一場比賽', ok: (s) => s.wins >= 1 },
    { id: 'win10', icon: '🎖️', name: '常勝軍', desc: '贏得 10 場比賽', ok: (s) => s.wins >= 10 },
    { id: 'flag', icon: '🚩', name: '搶旗英雄', desc: '搶旗得分 5 次', ok: (s) => s.caps >= 5 },
    { id: 'king', icon: '⛰️', name: '山大王', desc: '在山丘之王稱王一次', ok: (s) => s.kothWins >= 1 },
    { id: 'chicken', icon: '🐔', name: '大吉大利', desc: '大逃殺吃雞 3 次', ok: (s) => s.brWins >= 3 },
    { id: 'wave5', icon: '🛡️', name: '守住防線', desc: '生存闖關撐過第 5 波', ok: (s) => s.bestWave >= 5 },
    { id: 'wave15', icon: '🏰', name: '不朽要塞', desc: '生存闖關撐過第 15 波', ok: (s) => s.bestWave >= 15 },
    { id: 'boss', icon: '👹', name: '屠魔勇者', desc: '親手擊倒 BOSS', ok: (s) => s.bossK >= 1 },
    { id: 'air', icon: '✈️', name: '空中支援', desc: '用空襲炸掉敵人', ok: (s) => s.airK >= 1 },
    { id: 'crate', icon: '📦', name: '空投獵人', desc: '搶到 5 個空投', ok: (s) => s.crates >= 5 },
    { id: 'arty', icon: '🎇', name: '砲兵指揮官', desc: '用自走砲擊殺 10 次', ok: (s) => s.artyK >= 10 },
    { id: 'vet', icon: '🎮', name: '老兵', desc: '完成 20 場比賽', ok: (s) => s.games >= 20 },
  ];

  const XP = { kill: 10, rico: 6, boss: 40, cap: 30, ret: 10, round: 25, wave: 15, game: 20, win: 50, ach: 30, crate: 15 };

  const blank = () => ({
    xp: 0, skin: 'classic', ach: {},
    stats: { kills: 0, deaths: 0, games: 0, wins: 0, rico: 0, mineK: 0, barrelK: 0, caps: 0, kothWins: 0, brWins: 0, bestWave: 0, bestStreak: 0, bossK: 0, airK: 0, crates: 0, artyK: 0 },
  });

  function load() {
    const d = blank();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && typeof raw === 'object') {
        if (isFinite(raw.xp)) d.xp = Math.max(0, raw.xp);
        if (typeof raw.skin === 'string') d.skin = raw.skin;
        if (raw.ach && typeof raw.ach === 'object') d.ach = raw.ach;
        for (const k in d.stats) if (raw.stats && isFinite(raw.stats[k])) d.stats[k] = raw.stats[k];
      }
    } catch (e) {}
    return d;
  }
  let data = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };

  // 每升一級需要的經驗：Lv1→2 要 100，之後每級多 40
  const need = (lv) => 60 + lv * 40;
  function levelOf(xp) {
    let lv = 1, rest = xp;
    while (rest >= need(lv) && lv < 99) { rest -= need(lv); lv++; }
    return { lv, cur: rest, need: need(lv), pct: rest / need(lv) };
  }

  // 這一場的收穫（結算畫面用）
  let session = null;
  function newSession() { session = { xp: 0, lv0: levelOf(data.xp).lv, ach: [], lines: [] }; }
  newSession();

  const listeners = [];
  const emit = (type, payload) => listeners.forEach((fn) => { try { fn(type, payload); } catch (e) { console.error(e); } });

  function gain(n, why) {
    if (!n) return;
    const before = levelOf(data.xp).lv;
    data.xp += n;
    session.xp += n;
    if (why) {
      const line = session.lines.find((l) => l.why === why);
      if (line) { line.xp += n; line.n++; } else session.lines.push({ why, xp: n, n: 1 });
    }
    const after = levelOf(data.xp).lv;
    if (after > before) {
      const skins = SKINS.filter((s) => s.lv > before && s.lv <= after);
      emit('level', { lv: after, skins });
    }
    save();
  }

  function checkAch() {
    for (const a of ACH) {
      if (data.ach[a.id] || !a.ok(data.stats)) continue;
      data.ach[a.id] = Date.now();
      session.ach.push(a);
      emit('ach', a);
      gain(XP.ach, '成就獎勵');
    }
    save();
  }
  const bump = (k, n) => { data.stats[k] += n === undefined ? 1 : n; };
  const max = (k, v) => { if (v > data.stats[k]) data.stats[k] = v; };

  return {
    SKINS, ACH, XP, levelOf,
    on(fn) { listeners.push(fn); },
    get data() { return data; },
    get level() { return levelOf(data.xp); },
    get session() { return session; },
    newSession,
    get cls() { try { const v = localStorage.getItem('tb_cls'); return Core.CLASSES[v] ? v : 'medium'; } catch (e) { return 'medium'; } },
    set cls(v) { try { if (Core.CLASSES[v]) localStorage.setItem('tb_cls', v); } catch (e) {} },
    unlocked(skinId) { const s = SKINS.find((x) => x.id === skinId); return !!s && levelOf(data.xp).lv >= s.lv; },
    get skin() { return this.unlocked(data.skin) ? data.skin : 'classic'; },
    set skin(v) { if (this.unlocked(v)) { data.skin = v; save(); } },

    // ---- 遊戲事件
    kill({ rico, weapon, boss }) {
      bump('kills');
      gain(XP.kill, '擊殺');
      if (rico) { bump('rico'); gain(XP.rico, '反彈擊殺加分'); }
      if (weapon === 'mine') bump('mineK');
      if (weapon === 'barrel') bump('barrelK');
      if (weapon === 'air') bump('airK');
      if (weapon === 'arty') bump('artyK');
      if (boss) { bump('bossK'); gain(XP.boss, '擊倒 BOSS'); }
      checkAch();
    },
    death() { bump('deaths'); save(); },
    streak(n) { max('bestStreak', n); checkAch(); },
    capture() { bump('caps'); gain(XP.cap, '搶旗得分'); checkAch(); },
    crate() { bump('crates'); gain(XP.crate, '搶到空投'); checkAch(); },
    returned() { gain(XP.ret, '奪回旗子'); },
    roundWin() { bump('brWins'); gain(XP.round, '大逃殺吃雞'); checkAch(); },
    waveCleared(n) { max('bestWave', n); gain(XP.wave, '闖關過關'); checkAch(); },
    matchEnd({ won, mode, cleared }) {
      bump('games');
      gain(XP.game, '完成比賽');
      if (won) {
        bump('wins');
        gain(XP.win, '勝利');
        if (mode === 'koth') bump('kothWins');
      }
      if (cleared) max('bestWave', cleared);
      checkAch();
    },
  };
})();
