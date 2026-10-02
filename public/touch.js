/*
 * 手機觸控操作：
 *  左半邊：移動搖桿（手指按哪裡，搖桿就出現在哪裡）
 *  右半邊：瞄準搖桿，拖曳瞄準、放開開砲；輕點一下 = 自動瞄準最近的敵人開砲
 *  按鈕：💣 地雷、⚡ 衝刺
 */
const Touch = (() => {
  const { K } = Core;
  const R = 56;          // 搖桿半徑（px）
  const AIM_DEAD = 0.28; // 瞄準死區（比例）
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const forced = /[?&]touch\b/.test(location.search);
  const S = {
    enabled: false,
    move: null, aim: null,
    aimAngle: 0, latch: 0,
    autoAim: null,  // main.js 提供：() => 角度或 null
    rapid: () => false,
  };
  const $ = (id) => document.getElementById(id);

  function stickEl(id) {
    const base = $(id);
    return { base, knob: base.querySelector('.knob') };
  }

  function placeStick(el, x, y) {
    el.base.style.left = x + 'px';
    el.base.style.top = y + 'px';
    el.base.classList.add('active');
    el.knob.style.transform = 'translate(-50%, -50%)';
  }
  function moveKnob(el, dx, dy) { el.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; }
  function resetStick(el) {
    el.base.classList.remove('active');
    el.base.style.left = el.base.style.top = '';
    el.knob.style.transform = 'translate(-50%, -50%)';
  }

  function enable() {
    if (S.enabled) return;
    S.enabled = true;
    document.body.classList.add('touch');
    $('touchui').classList.remove('hidden');
    const zone = $('touchzone');
    const L = stickEl('stickL'), Rs = stickEl('stickR');

    const vec = (t, e) => {
      let dx = e.clientX - t.ox, dy = e.clientY - t.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      return { dx, dy, mag: Math.min(1, d / R) };
    };

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Sfx.init();
      const left = e.clientX < innerWidth / 2;
      if (left && !S.move) {
        S.move = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0, mag: 0 };
        placeStick(L, e.clientX, e.clientY);
      } else if (!left && !S.aim) {
        S.aim = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0, mag: 0, max: 0, t0: performance.now() };
        placeStick(Rs, e.clientX, e.clientY);
      } else return;
      try { zone.setPointerCapture(e.pointerId); } catch (err) {}
    }, { passive: false });

    zone.addEventListener('pointermove', (e) => {
      if (S.move && e.pointerId === S.move.id) {
        Object.assign(S.move, vec(S.move, e));
        moveKnob(L, S.move.dx, S.move.dy);
      } else if (S.aim && e.pointerId === S.aim.id) {
        Object.assign(S.aim, vec(S.aim, e));
        S.aim.max = Math.max(S.aim.max, S.aim.mag);
        if (S.aim.mag > AIM_DEAD) S.aimAngle = Math.atan2(S.aim.dy, S.aim.dx);
        moveKnob(Rs, S.aim.dx, S.aim.dy);
      }
    });

    const end = (e) => {
      if (S.move && e.pointerId === S.move.id) {
        S.move = null;
        resetStick(L);
      } else if (S.aim && e.pointerId === S.aim.id) {
        const a = S.aim;
        S.aim = null;
        resetStick(Rs);
        if (e.type === 'pointercancel') return;
        if (a.max > AIM_DEAD) {
          if (a.mag > AIM_DEAD * 0.5) S.aimAngle = Math.atan2(a.dy, a.dx);
          S.latch |= K.FIRE;
        } else {
          const ang = S.autoAim ? S.autoAim() : null;
          if (ang !== null) S.aimAngle = ang;
          S.latch |= K.FIRE;
        }
      }
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const btn = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sfx.init(); fn(); });
    btn('btnMine', () => (S.latch |= K.MINE));
    btn('btnDash', () => (S.latch |= K.DASH));
  }

  function keys() {
    let k = 0;
    const m = S.move;
    if (m && m.mag > 0.25) {
      const ca = m.dx / Math.hypot(m.dx, m.dy), sa = m.dy / Math.hypot(m.dx, m.dy);
      if (ca > 0.38) k |= K.RIGHT;
      if (ca < -0.38) k |= K.LEFT;
      if (sa > 0.38) k |= K.DOWN;
      if (sa < -0.38) k |= K.UP;
    }
    // 拿到狂暴連射時，按住瞄準搖桿就會一直開火
    if (S.aim && S.aim.max > AIM_DEAD && S.rapid() && performance.now() - S.aim.t0 > 250) k |= K.FIRE;
    k |= S.latch;
    S.latch = 0;
    return k;
  }

  return {
    available: coarse || forced,
    enable,
    keys,
    get enabled() { return S.enabled; },
    get aimAngle() { return S.aimAngle; },
    set aimAngle(v) { S.aimAngle = v; },
    get aiming() { return !!(S.aim && S.aim.max > AIM_DEAD); },
    set autoAim(fn) { S.autoAim = fn; },
    set rapid(fn) { S.rapid = fn; },
  };
})();
