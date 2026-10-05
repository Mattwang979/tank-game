/* 音效與背景音樂：全部用 WebAudio 即時合成，不需要任何音檔 */
const Sfx = (() => {
  let ctx = null, master, sfxGain, musicGain, noiseBuf;
  const store = (k, d) => { try { const v = localStorage.getItem('tb_' + k); return v === null ? d : v === '1'; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem('tb_' + k, v ? '1' : '0'); } catch {} };
  let sfxOn = store('sfx', true), musicOn = store('music', true);
  const listener = { x: 640, y: 400 };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain(); master.gain.value = 0.75;
    master.connect(comp); comp.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = sfxOn ? 1 : 0; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (musicOn) Music.start();
  }

  function out(x, y) {
    if (x === undefined) return sfxGain;
    const dx = x - listener.x, dy = y - listener.y;
    const dist = Math.hypot(dx, dy);
    const g = ctx.createGain();
    g.gain.value = Math.max(0.28, 1 - dist / 1500);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, dx / 800)) * 0.65;
      g.connect(p); p.connect(sfxGain);
    } else g.connect(sfxGain);
    return g;
  }

  function tone({ type = 'sine', f0 = 440, f1, dur = 0.1, vol = 0.3, at = 0, attack = 0.004, dest, filter }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filter;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise({ dur = 0.2, vol = 0.3, type = 'lowpass', f0 = 1000, f1, q = 1, at = 0, attack = 0.003, dest }) {
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxGain);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  const S = {
    shot(x, y, rapid) {
      const d = out(x, y);
      if (rapid) {
        noise({ dur: 0.07, vol: 0.35, type: 'bandpass', f0: 2200, f1: 600, q: 0.8, dest: d });
        tone({ type: 'square', f0: 420, f1: 110, dur: 0.06, vol: 0.12, dest: d });
      } else {
        noise({ dur: 0.16, vol: 0.55, type: 'bandpass', f0: 1500, f1: 250, q: 0.7, dest: d });
        tone({ type: 'square', f0: 240, f1: 50, dur: 0.13, vol: 0.22, dest: d, filter: 1200 });
      }
    },
    rail(x, y) {
      const d = out(x, y);
      tone({ type: 'sawtooth', f0: 2400, f1: 120, dur: 0.45, vol: 0.25, dest: d, filter: 5000 });
      tone({ type: 'square', f0: 90, f1: 40, dur: 0.3, vol: 0.2, dest: d });
      noise({ dur: 0.35, vol: 0.3, type: 'highpass', f0: 3000, f1: 800, dest: d });
    },
    bounce(x, y) { tone({ type: 'triangle', f0: 1700, f1: 900, dur: 0.07, vol: 0.12, dest: out(x, y) }); },
    spark(x, y) { noise({ dur: 0.05, vol: 0.15, type: 'highpass', f0: 3000, dest: out(x, y) }); },
    clash(x, y) {
      const d = out(x, y);
      tone({ type: 'triangle', f0: 2100, dur: 0.2, vol: 0.15, dest: d });
      tone({ type: 'triangle', f0: 2730, dur: 0.18, vol: 0.12, dest: d });
    },
    brick(x, y) { noise({ dur: 0.25, vol: 0.35, type: 'lowpass', f0: 900, f1: 200, dest: out(x, y) }); },
    hit(x, y) {
      const d = out(x, y);
      tone({ type: 'sine', f0: 180, f1: 50, dur: 0.15, vol: 0.45, dest: d });
      noise({ dur: 0.08, vol: 0.25, type: 'lowpass', f0: 2500, dest: d });
    },
    shieldHit(x, y) { tone({ type: 'sine', f0: 900, f1: 1400, dur: 0.15, vol: 0.18, dest: out(x, y) }); },
    hitConfirm() {
      tone({ type: 'square', f0: 1300, dur: 0.04, vol: 0.09 });
      tone({ type: 'square', f0: 1750, dur: 0.05, vol: 0.08, at: 0.035 });
    },
    hurt() {
      tone({ type: 'sine', f0: 110, f1: 35, dur: 0.25, vol: 0.6 });
      noise({ dur: 0.15, vol: 0.3, type: 'lowpass', f0: 600 });
    },
    boom(x, y, size) {
      const d = out(x, y), s = size || 1;
      noise({ dur: 0.7 * s + 0.2, vol: 0.9, type: 'lowpass', f0: 2600, f1: 60, q: 0.5, dest: d });
      tone({ type: 'sine', f0: 130, f1: 28, dur: 0.6 * s + 0.1, vol: 0.75, dest: d });
      noise({ dur: 0.1, vol: 0.4, type: 'highpass', f0: 1500, dest: d });
    },
    mine(x, y) {
      const d = out(x, y);
      tone({ type: 'square', f0: 520, dur: 0.05, vol: 0.1, dest: d, filter: 2000 });
      tone({ type: 'square', f0: 780, dur: 0.06, vol: 0.1, at: 0.07, dest: d, filter: 2000 });
    },
    armed() { tone({ type: 'sine', f0: 1600, dur: 0.06, vol: 0.08 }); tone({ type: 'sine', f0: 1600, dur: 0.06, vol: 0.08, at: 0.1 }); },
    dry() { tone({ type: 'square', f0: 180, dur: 0.03, vol: 0.08 }); },
    pickup(x, y) {
      const d = out(x, y);
      [660, 880, 1320, 1760].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.16, at: i * 0.055, dest: d }));
    },
    puSpawn(x, y) { tone({ type: 'sine', f0: 500, f1: 1000, dur: 0.25, vol: 0.06, dest: out(x, y) }); },
    dash(x, y) { noise({ dur: 0.22, vol: 0.3, type: 'bandpass', f0: 300, f1: 2500, q: 1.5, dest: out(x, y) }); },
    spawn(x, y) { tone({ type: 'sine', f0: 200, f1: 900, dur: 0.35, vol: 0.12, dest: out(x, y) }); },
    kill() {
      tone({ type: 'sawtooth', f0: 330, dur: 0.18, vol: 0.12, filter: 2500 });
      tone({ type: 'sawtooth', f0: 495, dur: 0.18, vol: 0.1, filter: 2500 });
      tone({ type: 'sawtooth', f0: 660, dur: 0.35, vol: 0.12, at: 0.12, filter: 3000 });
    },
    announce(big) {
      const v = big ? 0.13 : 0.08;
      [164.8, 246.9, 329.6, 493.9].forEach((f) => tone({ type: 'sawtooth', f0: f, dur: big ? 0.9 : 0.5, vol: v, attack: 0.02, filter: 2200 }));
      if (big) noise({ dur: 0.6, vol: 0.2, type: 'highpass', f0: 4000, f1: 9000 });
    },
    death() {
      tone({ type: 'sawtooth', f0: 420, f1: 45, dur: 0.9, vol: 0.18, filter: 1500 });
    },
    taunt(x, y) { tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.1, vol: 0.1, dest: out(x, y) }); },
    tick() { tone({ type: 'square', f0: 1000, dur: 0.05, vol: 0.06 }); },
    fizzle(x, y) { noise({ dur: 0.12, vol: 0.08, type: 'highpass', f0: 2000, dest: out(x, y) }); },

    // ---- 新武器
    missile(x, y) {
      const d = out(x, y);
      noise({ dur: 0.45, vol: 0.35, type: 'bandpass', f0: 400, f1: 2600, q: 1.2, dest: d });
      tone({ type: 'sawtooth', f0: 90, f1: 160, dur: 0.3, vol: 0.12, dest: d, filter: 900 });
    },
    shotgun(x, y) {
      const d = out(x, y);
      noise({ dur: 0.28, vol: 0.8, type: 'lowpass', f0: 3200, f1: 300, q: 0.6, dest: d });
      tone({ type: 'square', f0: 160, f1: 40, dur: 0.18, vol: 0.3, dest: d, filter: 900 });
    },
    flame(x, y) { noise({ dur: 0.16, vol: 0.22, type: 'bandpass', f0: 700 + Math.random() * 500, q: 0.7, dest: out(x, y) }); },
    cloak(x, y) { tone({ type: 'sine', f0: 1800, f1: 300, dur: 0.4, vol: 0.12, dest: out(x, y) }); },
    // ---- 地形
    port(x, y) {
      const d = out(x, y);
      tone({ type: 'sine', f0: 300, f1: 1800, dur: 0.18, vol: 0.18, dest: d });
      tone({ type: 'triangle', f0: 1800, f1: 400, dur: 0.22, vol: 0.12, at: 0.12, dest: d });
    },
    pad(x, y) { noise({ dur: 0.25, vol: 0.22, type: 'bandpass', f0: 500, f1: 3500, q: 2, dest: out(x, y) }); },
    // ---- 模式
    flagTake() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.1, vol: 0.08, at: i * 0.07, filter: 3000 })); },
    flagDrop() { [784, 523].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.16, vol: 0.12, at: i * 0.1 })); },
    flagRet() { [659, 988].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.12, at: i * 0.08 })); },
    flagCap() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'sawtooth', f0: f, dur: 0.2, vol: 0.09, at: i * 0.08, filter: 3500 }));
      noise({ dur: 0.8, vol: 0.18, type: 'highpass', f0: 5000, at: 0.3 });
    },
    horn() {
      tone({ type: 'sawtooth', f0: 220, dur: 0.5, vol: 0.12, filter: 1400, attack: 0.05 });
      tone({ type: 'sawtooth', f0: 330, dur: 0.5, vol: 0.1, filter: 1400, attack: 0.05 });
    },
    siren() { tone({ type: 'sawtooth', f0: 500, f1: 900, dur: 0.5, vol: 0.08, filter: 2000 }); tone({ type: 'sawtooth', f0: 900, f1: 500, dur: 0.5, vol: 0.08, at: 0.5, filter: 2000 }); },
    boss() {
      tone({ type: 'sawtooth', f0: 70, f1: 45, dur: 1.4, vol: 0.3, filter: 600, attack: 0.1 });
      noise({ dur: 1.2, vol: 0.25, type: 'lowpass', f0: 400, f1: 80, attack: 0.2 });
    },
    levelUp() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.14, vol: 0.09, at: i * 0.09, filter: 4000 }));
      [1047, 1319, 1568].forEach((f) => tone({ type: 'triangle', f0: f, dur: 0.7, vol: 0.08, at: 0.4 }));
    },
    ach() { [1319, 1760, 2093].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.25, vol: 0.1, at: i * 0.07 })); },

    // ---- 坦克種類
    heavyShot(x, y) {
      const d = out(x, y);
      noise({ dur: 0.3, vol: 0.75, type: 'lowpass', f0: 1800, f1: 120, q: 0.6, dest: d });
      tone({ type: 'square', f0: 140, f1: 35, dur: 0.22, vol: 0.3, dest: d, filter: 700 });
    },
    tdShot(x, y) {
      const d = out(x, y);
      tone({ type: 'sawtooth', f0: 1800, f1: 200, dur: 0.12, vol: 0.18, dest: d, filter: 4000 });
      noise({ dur: 0.18, vol: 0.6, type: 'bandpass', f0: 2600, f1: 400, q: 0.9, dest: d });
      tone({ type: 'square', f0: 220, f1: 60, dur: 0.15, vol: 0.2, dest: d, filter: 1000 });
    },
    arty(x, y) {
      const d = out(x, y);
      tone({ type: 'sine', f0: 95, f1: 30, dur: 0.5, vol: 0.7, dest: d });
      noise({ dur: 0.45, vol: 0.55, type: 'lowpass', f0: 900, f1: 80, q: 0.5, dest: d });
    },
    // 砲彈 / 炸彈快落地的呼嘯聲
    whistle(x, y, dur) {
      tone({ type: 'sine', f0: 1900, f1: 520, dur: dur || 0.7, vol: 0.07, attack: 0.08, dest: out(x, y) });
    },
    // ---- 空投、空襲
    plane(x, y, dur) {
      const d = out(x, y), T = dur || 2.4;
      tone({ type: 'sawtooth', f0: 78, f1: 62, dur: T, vol: 0.12, attack: T * 0.4, dest: d, filter: 420 });
      tone({ type: 'sawtooth', f0: 117, f1: 92, dur: T, vol: 0.06, attack: T * 0.4, dest: d, filter: 600 });
      noise({ dur: T, vol: 0.1, type: 'bandpass', f0: 300, f1: 180, q: 0.8, attack: T * 0.4, dest: d });
    },
    land(x, y) {
      const d = out(x, y);
      tone({ type: 'sine', f0: 110, f1: 40, dur: 0.3, vol: 0.5, dest: d });
      noise({ dur: 0.2, vol: 0.35, type: 'lowpass', f0: 1400, f1: 200, dest: d });
      [880, 1175].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.08, at: 0.15 + i * 0.08, dest: d }));
    },
    aircall() {
      [1250, 1250, 1660].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.07, vol: 0.06, at: i * 0.11, filter: 3000 }));
      noise({ dur: 0.25, vol: 0.1, type: 'bandpass', f0: 1800, q: 2, at: 0.36 });
    },
    countdown(go) { tone({ type: 'square', f0: go ? 1320 : 660, dur: go ? 0.4 : 0.12, vol: 0.09, filter: 3000 }); },
  };

  // ---------------- 背景音樂：E 小調硬派鼓組 + 貝斯 + 琶音
  const Music = {
    playing: false, next: 0, step: 0, timer: null, bpm: 152,
    start() {
      if (!ctx || this.playing) return;
      this.playing = true;
      this.next = ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = setInterval(() => this.schedule(), 25);
    },
    stop() { clearInterval(this.timer); this.playing = false; },
    schedule() {
      const spb = 60 / this.bpm / 4;
      while (this.next < ctx.currentTime + 0.15) {
        this.play(this.step, this.next - ctx.currentTime);
        this.next += spb;
        this.step = (this.step + 1) % 128;
      }
    },
    play(step, at) {
      const m = musicGain;
      const bar = (step >> 4) % 8, s = step % 16;
      const prog = [[40, 0], [40, 0], [36, 1], [38, 1], [40, 0], [40, 0], [36, 1], [35, 1]][bar];
      const root = prog[0], third = prog[1] ? 4 : 3;
      const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
      // kick
      if (s % 4 === 0 || (bar % 4 === 3 && (s === 10 || s === 14))) tone({ type: 'sine', f0: 150, f1: 40, dur: 0.16, vol: 0.9, at, dest: m });
      // snare
      if (s === 4 || s === 12) {
        noise({ dur: 0.14, vol: 0.45, type: 'highpass', f0: 1200, at, dest: m });
        tone({ type: 'triangle', f0: 220, f1: 140, dur: 0.08, vol: 0.25, at, dest: m });
      }
      if (bar === 7 && s >= 12) noise({ dur: 0.08, vol: 0.3, type: 'highpass', f0: 1500, at, dest: m });
      // hats
      if (s % 2 === 0) noise({ dur: s % 4 === 2 ? 0.09 : 0.03, vol: 0.1, type: 'highpass', f0: 8000, at, dest: m });
      // bass（八分音符推進）
      if (s % 2 === 0) {
        const n = root + (s % 8 === 6 ? 12 : 0);
        tone({ type: 'sawtooth', f0: mtof(n), dur: 0.17, vol: 0.32, at, dest: m, filter: 700 });
      }
      // 琶音
      const arp = [0, 7, 12, 7, third, 7, 12 + third, 12];
      const n = root + 24 + arp[s % 8];
      tone({ type: 'square', f0: mtof(n), dur: 0.09, vol: 0.045, at, dest: m, filter: 2600 });
    },
  };

  return {
    init,
    play(name, ...args) { if (!ctx || !sfxOn || !S[name]) return; try { S[name](...args); } catch {} },
    setListener(x, y) { listener.x = x; listener.y = y; },
    toggleSfx() { sfxOn = !sfxOn; save('sfx', sfxOn); if (sfxGain) sfxGain.gain.value = sfxOn ? 1 : 0; return sfxOn; },
    toggleMusic() { musicOn = !musicOn; save('music', musicOn); if (ctx) { if (musicOn) Music.start(); else Music.stop(); } return musicOn; },
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
  };
})();
