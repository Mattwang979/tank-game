/* 繪圖：地圖預先繪製、坦克、砲彈、粒子特效、畫面震動 */
const Render = (() => {
  const { TILE, T, C } = Core;
  let cv, ctx, dpr = 1;
  const view = { s: 1, ox: 0, oy: 0, cw: 0, ch: 0 };
  let map = null, W = 0, H = 0;
  let groundCv = null, bushCv = null, decalCv = null, decalCtx = null;
  let groundDirty = true, decalFadeT = 0;
  let waterTiles = [];
  const particles = [], rings = [], beams = [], floaters = [], ghosts = [];
  const treads = new Map();
  let shake = 0, hurtFlash = 0, hitMarker = 0, time = 0, killFlash = 0;

  const PU_COLOR = { heal: '#5cff6e', shield: '#7fe3ff', rapid: '#ffb142', triple: '#ffd84d', rail: '#ff6ec7', mines: '#ff5a3d', speed: '#4da6ff' };

  // ---------------------------------------------------------------- 工具
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return `rgb(${r},${g},${b})`;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- 版面
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    addEventListener('resize', resize);
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.cw = innerWidth; view.ch = innerHeight;
    cv.width = Math.round(view.cw * dpr);
    cv.height = Math.round(view.ch * dpr);
    layout();
  }
  function layout() {
    if (!map) return;
    const top = view.ch > 600 ? 52 : 40, bottom = view.ch > 600 ? 76 : 56;
    const availH = Math.max(200, view.ch - top - bottom);
    view.s = Math.min((view.cw - 8) / W, availH / H);
    view.ox = (view.cw - W * view.s) / 2;
    view.oy = top + (availH - H * view.s) / 2;
    groundDirty = true;
  }
  const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });

  function setMap(m) {
    map = m;
    W = m.w * TILE; H = m.h * TILE;
    decalCv = document.createElement('canvas');
    decalCv.width = W; decalCv.height = H;
    decalCtx = decalCv.getContext('2d');
    treads.clear();
    particles.length = rings.length = beams.length = floaters.length = ghosts.length = 0;
    layout();
  }

  // ---------------------------------------------------------------- 地圖預繪
  function buildGround() {
    groundDirty = false;
    const sc = view.s * dpr;
    groundCv = groundCv || document.createElement('canvas');
    bushCv = bushCv || document.createElement('canvas');
    groundCv.width = bushCv.width = Math.ceil(W * sc);
    groundCv.height = bushCv.height = Math.ceil(H * sc);
    const g = groundCv.getContext('2d');
    const b = bushCv.getContext('2d');
    g.setTransform(sc, 0, 0, sc, 0, 0);
    b.setTransform(sc, 0, 0, sc, 0, 0);
    b.clearRect(0, 0, W, H);
    waterTiles = [];

    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const x = tx * TILE, y = ty * TILE;
        g.fillStyle = (tx + ty) & 1 ? '#2b3427' : '#283124';
        g.fillRect(x, y, TILE, TILE);
        for (let i = 0; i < 4; i++) {
          g.fillStyle = hash(tx, ty, i) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
          const s = 2 + hash(tx, ty, i + 9) * 4;
          g.fillRect(x + hash(tx, ty, i + 3) * 36, y + hash(tx, ty, i + 6) * 36, s, s);
        }
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += TILE) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0; y <= H; y += TILE) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();

    // 水
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      if (map.tiles[ty * map.w + tx] !== T.WATER) continue;
      const x = tx * TILE, y = ty * TILE;
      g.fillStyle = '#123f61';
      g.fillRect(x, y, TILE, TILE);
      const edge = (dx, dy) => Core.tileAt(map, tx + dx, ty + dy) !== T.WATER;
      g.fillStyle = 'rgba(160,210,170,0.35)';
      if (edge(0, -1)) g.fillRect(x, y, TILE, 3);
      if (edge(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
      if (edge(-1, 0)) g.fillRect(x, y, 3, TILE);
      if (edge(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
      waterTiles.push([x, y]);
    }

    // 陰影
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[ty * map.w + tx];
      if (t === T.STEEL || t === T.BRICK) g.fillRect(tx * TILE + 5, ty * TILE + 6, TILE, TILE);
      else if (t === T.BARREL) { g.beginPath(); g.arc(tx * TILE + 24, ty * TILE + 25, 15, 0, Math.PI * 2); g.fill(); }
    }

    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx, t = map.tiles[i];
      const x = tx * TILE, y = ty * TILE;
      if (t === T.STEEL) drawSteel(g, x, y, tx, ty);
      else if (t === T.BRICK) drawBrick(g, x, y, map.hp[i], tx, ty);
      else if (t === T.BARREL) drawBarrel(g, x + TILE / 2, y + TILE / 2);
      else if (t === T.BUSH) drawBush(b, x, y, tx, ty);
    }
  }

  function drawSteel(g, x, y, tx, ty) {
    const S = (dx, dy) => Core.tileAt(map, tx + dx, ty + dy) === T.STEEL;
    g.fillStyle = '#5b6470';
    g.fillRect(x, y, TILE, TILE);
    g.fillStyle = '#8e98a5';
    if (!S(0, -1)) g.fillRect(x, y, TILE, 3);
    if (!S(-1, 0)) g.fillRect(x, y, 3, TILE);
    g.fillStyle = '#373e47';
    if (!S(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
    if (!S(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
    g.fillStyle = '#6a7480';
    g.fillRect(x + 8, y + 8, TILE - 16, TILE - 16);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.strokeRect(x + 8.5, y + 8.5, TILE - 17, TILE - 17);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(x + 8, y + 8); g.lineTo(x + TILE - 8, y + 8); g.lineTo(x + 8, y + TILE - 8); g.fill();
    g.fillStyle = '#aab3be';
    for (const [rx, ry] of [[5, 5], [TILE - 5, 5], [5, TILE - 5], [TILE - 5, TILE - 5]]) {
      g.beginPath(); g.arc(x + rx, y + ry, 1.8, 0, Math.PI * 2); g.fill();
    }
  }

  function drawBrick(g, x, y, hp, tx, ty) {
    g.fillStyle = '#5b2c16';
    g.fillRect(x, y, TILE, TILE);
    for (let r = 0; r < 4; r++) {
      const y0 = y + r * 10;
      for (let c = -1; c < 2; c++) {
        const x0 = x + c * 20 + (r % 2 ? 10 : 0);
        const bx = Math.max(x, x0 + 1), bw = Math.min(x + TILE, x0 + 19) - bx;
        if (bw <= 0) continue;
        const v = hash(tx * 4 + c, ty * 4 + r);
        g.fillStyle = v > 0.66 ? '#a85a33' : v > 0.33 ? '#9a4f2c' : '#8d4626';
        g.fillRect(bx, y0 + 1, bw, 8);
        g.fillStyle = 'rgba(255,220,180,0.15)';
        g.fillRect(bx, y0 + 1, bw, 1.5);
      }
    }
    if (hp < 3) {
      g.strokeStyle = 'rgba(20,8,0,0.85)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x + 6, y + 4); g.lineTo(x + 16, y + 17); g.lineTo(x + 12, y + 27); g.lineTo(x + 22, y + 36);
      if (hp < 2) {
        g.moveTo(x + 34, y + 5); g.lineTo(x + 24, y + 15); g.lineTo(x + 30, y + 26); g.lineTo(x + 20, y + 30);
        g.moveTo(x + 16, y + 17); g.lineTo(x + 26, y + 15);
      }
      g.stroke();
      if (hp < 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, TILE, TILE); }
    }
  }

  function drawBarrel(g, cx, cy) {
    g.fillStyle = '#6d140f';
    g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c62a20';
    g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7d1a12'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffd84d';
    g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 6, cy + 5); g.lineTo(cx - 6, cy + 5); g.closePath(); g.fill();
    g.fillStyle = '#000';
    g.fillRect(cx - 0.8, cy - 2.5, 1.6, 4); g.fillRect(cx - 0.8, cy + 2.4, 1.6, 1.4);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.arc(cx - 5, cy - 5, 4, 0, Math.PI * 2); g.fill();
  }

  function drawBush(b, x, y, tx, ty) {
    for (let i = 0; i < 6; i++) {
      const px = x + 6 + hash(tx, ty, i) * 28, py = y + 6 + hash(tx, ty, i + 20) * 28;
      const r = 10 + hash(tx, ty, i + 40) * 6;
      b.fillStyle = '#1f5a22';
      b.beginPath(); b.arc(px, py, r, 0, Math.PI * 2); b.fill();
    }
    for (let i = 0; i < 6; i++) {
      const px = x + 6 + hash(tx, ty, i) * 28, py = y + 6 + hash(tx, ty, i + 20) * 28;
      const r = 10 + hash(tx, ty, i + 40) * 6;
      b.fillStyle = i % 2 ? '#2f7d32' : '#3a9140';
      b.beginPath(); b.arc(px - 2, py - 2, r - 3, 0, Math.PI * 2); b.fill();
      b.fillStyle = 'rgba(180,255,150,0.18)';
      b.beginPath(); b.arc(px - 4, py - 4, r * 0.35, 0, Math.PI * 2); b.fill();
    }
  }

  // ---------------------------------------------------------------- 粒子
  function P(p) {
    if (particles.length > 1600) particles.splice(0, 200);
    p.max = p.life;
    if (p.r1 === undefined) p.r1 = p.r;
    if (p.drag === undefined) p.drag = 3;
    particles.push(p);
  }
  function sparks(x, y, n, color, speed, life, a, spread) {
    for (let i = 0; i < n; i++) {
      const ang = a === undefined ? Math.random() * Math.PI * 2 : a + (Math.random() - 0.5) * (spread || 0.8);
      const sp = rand(speed * 0.4, speed);
      P({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(life * 0.5, life), r: rand(1.2, 2.4), r1: 0.3, c: color, add: true, kind: 'line', drag: 4 });
    }
  }
  function smoke(x, y, n, r, life, color) {
    for (let i = 0; i < n; i++) {
      P({ x: x + rand(-r, r) * 0.4, y: y + rand(-r, r) * 0.4, vx: rand(-25, 25), vy: rand(-25, 25), life: rand(life * 0.6, life), r: r * rand(0.4, 0.7), r1: r * rand(1, 1.6), c: color || 'rgba(70,70,70,0.45)', drag: 1.5 });
    }
  }
  function debris(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(speed * 0.3, speed);
      P({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.9), r: rand(1.5, 3.5), c: color, kind: 'sq', rot: Math.random() * 6, vr: rand(-12, 12), drag: 4 });
    }
  }
  function floater(x, y, text, c, size) {
    floaters.push({ x: x + rand(-6, 6), y, text, c, life: 0.9, max: 0.9, size: size || 15 });
  }

  const fx = {
    shot(x, y, a, color, rapid) {
      sparks(x, y, rapid ? 3 : 7, '#ffd27a', 380, 0.16, a, 0.6);
      P({ x, y, vx: 0, vy: 0, life: 0.08, r: rapid ? 8 : 13, r1: 3, c: 'rgba(255,230,160,0.95)', add: true });
      if (!rapid) smoke(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 3, 10, 0.5, 'rgba(120,120,120,0.35)');
    },
    bounce(x, y) { sparks(x, y, 6, '#fff4c2', 260, 0.18); P({ x, y, vx: 0, vy: 0, life: 0.07, r: 7, r1: 2, c: 'rgba(255,255,220,0.9)', add: true }); },
    spark(x, y, brick) {
      sparks(x, y, 5, '#ffc070', 200, 0.15);
      if (brick) debris(x, y, 4, '#9a4f2c', 120);
    },
    clash(x, y) {
      P({ x, y, vx: 0, vy: 0, life: 0.14, r: 16, r1: 4, c: 'rgba(255,255,255,0.95)', add: true });
      sparks(x, y, 12, '#ffffff', 320, 0.22);
      rings.push({ x, y, r0: 4, r1: 30, life: 0.2, max: 0.2, c: '255,255,255', w: 2 });
    },
    hit(x, y, dmg, shield, mine) {
      sparks(x, y, 8, shield ? '#7fe3ff' : '#ffb070', 260, 0.25);
      floater(x, y - 22, '-' + dmg, shield ? '#7fe3ff' : mine ? '#ff5a5a' : '#ffffff', dmg >= 60 ? 22 : 16);
    },
    boom(x, y, r, kind, meX, meY) {
      const s = r / 100;
      P({ x, y, vx: 0, vy: 0, life: 0.13, r: r * 0.5, r1: r * 0.95, c: 'rgba(255,245,200,0.9)', add: true, drag: 0 });
      for (let i = 0; i < 16 * s + 4; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(30, 220) * s;
        P({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), r: rand(8, 18) * s, r1: 2, c: Math.random() < 0.5 ? 'rgba(255,170,60,0.9)' : 'rgba(255,90,30,0.85)', add: true, drag: 3 });
      }
      smoke(x, y, Math.round(10 * s + 3), 26 * s, 1.4, 'rgba(50,48,46,0.5)');
      debris(x, y, Math.round(10 * s), '#2a2a2a', 380 * s);
      sparks(x, y, Math.round(14 * s), '#ffdd88', 520 * s, 0.4);
      rings.push({ x, y, r0: 8, r1: r * 1.1, life: 0.32, max: 0.32, c: '255,220,160', w: 5 });
      if (decalCtx) {
        const gr = decalCtx.createRadialGradient(x, y, 0, x, y, r * 0.5);
        gr.addColorStop(0, 'rgba(0,0,0,0.55)');
        gr.addColorStop(0.6, 'rgba(10,8,5,0.3)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        decalCtx.fillStyle = gr;
        decalCtx.beginPath(); decalCtx.arc(x, y, r * 0.5, 0, Math.PI * 2); decalCtx.fill();
      }
      const d = meX === undefined ? 400 : Math.hypot(meX - x, meY - y);
      shake = Math.min(22, shake + (r / 9) * Math.max(0.25, 1 - d / 900));
    },
    tankDeath(x, y, color) {
      debris(x, y, 14, color, 340);
      debris(x, y, 8, '#222', 260);
      smoke(x, y, 6, 22, 2.2, 'rgba(30,30,30,0.55)');
    },
    brick(i) {
      const x = (i % map.w) * TILE + TILE / 2, y = Math.floor(i / map.w) * TILE + TILE / 2;
      debris(x, y, 14, '#a85a33', 220);
      debris(x, y, 6, '#5b2c16', 160);
      smoke(x, y, 5, 18, 0.9, 'rgba(130,100,80,0.4)');
    },
    rail(pts, color) {
      beams.push({ pts, life: 0.45, max: 0.45, c: color });
      for (let i = 1; i < pts.length; i++) sparks(pts[i][0], pts[i][1], 6, '#ffd0f0', 240, 0.25);
      shake = Math.min(22, shake + 4);
    },
    pickup(x, y, k, text) {
      const c = PU_COLOR[k] || '#fff';
      rings.push({ x, y, r0: 8, r1: 46, life: 0.4, max: 0.4, c: hexRgb(c), w: 3 });
      sparks(x, y, 14, c, 220, 0.4);
      floater(x, y - 26, text, c, 16);
    },
    spawn(x, y, color) {
      rings.push({ x, y, r0: 60, r1: 14, life: 0.45, max: 0.45, c: hexRgb(color), w: 3 });
      rings.push({ x, y, r0: 90, r1: 20, life: 0.6, max: 0.6, c: hexRgb(color), w: 1.5 });
    },
    dash(x, y, a, tank) {
      smoke(x, y, 5, 12, 0.5, 'rgba(160,150,130,0.35)');
      if (tank) for (let i = 1; i <= 3; i++) ghosts.push({ ...tank, life: 0.1 + i * 0.06, max: 0.1 + i * 0.06 });
    },
    fizzle(x, y) { smoke(x, y, 2, 6, 0.35, 'rgba(160,160,160,0.4)'); },
    mineArm(x, y, color) { rings.push({ x, y, r0: 4, r1: 22, life: 0.3, max: 0.3, c: hexRgb(color), w: 2 }); },
    puSpawn(x, y, k) { rings.push({ x, y, r0: 40, r1: 6, life: 0.5, max: 0.5, c: hexRgb(PU_COLOR[k] || '#ffffff'), w: 3 }); },
    hurt(amount) { hurtFlash = Math.min(0.75, hurtFlash + 0.25 + amount / 140); shake = Math.min(22, shake + 3 + amount / 12); },
    hitMarker() { hitMarker = 0.18; },
    killConfirm() { killFlash = 0.35; },
    shake(v) { shake = Math.min(22, shake + v); },
  };
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
  }

  function tileChanged() { groundDirty = true; }

  // ---------------------------------------------------------------- 物件繪製
  function drawTank(c, t, alpha) {
    c.save();
    c.globalAlpha = alpha;
    c.translate(t.x, t.y);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(3, 5, 19, 17, 0, 0, Math.PI * 2); c.fill();
    c.rotate(t.ha);
    c.fillStyle = '#17191c';
    c.fillRect(-18, -16, 36, 9);
    c.fillRect(-18, 7, 36, 9);
    c.fillStyle = '#3d424a';
    const off = ((t.dist || 0) % 6 + 6) % 6;
    for (let i = -18 + off; i < 17; i += 6) { c.fillRect(i, -16, 2, 9); c.fillRect(i, 7, 2, 9); }
    c.fillStyle = shade(t.color, -0.45);
    rr(c, -15, -11, 30, 22, 4); c.fill();
    c.fillStyle = t.color;
    rr(c, -13, -9, 26, 18, 3); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(-13, -9, 26, 3.5);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(10, -7, 2, 14);
    c.rotate(t.ta - t.ha);
    const rc = t.recoil || 0;
    const barrel = t.flags & 32 ? '#ff6ec7' : t.flags & 8 ? '#ffb142' : shade(t.color, -0.25);
    c.fillStyle = '#1e2124';
    c.fillRect(4 - rc, -4.5, 22, 9);
    c.fillStyle = barrel;
    c.fillRect(5 - rc, -3, 20, 6);
    c.fillStyle = '#1e2124';
    c.fillRect(23 - rc, -5, 5, 10);
    if (t.flags & 16) {
      c.fillStyle = '#1e2124';
      c.save(); c.rotate(-0.35); c.fillRect(6, -2, 15, 4); c.restore();
      c.save(); c.rotate(0.35); c.fillRect(6, -2, 15, 4); c.restore();
    }
    c.fillStyle = shade(t.color, -0.35);
    c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
    c.fillStyle = shade(t.color, 0.12);
    c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = shade(t.color, -0.2);
    c.beginPath(); c.arc(-2, 0, 3.2, 0, Math.PI * 2); c.fill();
    c.restore();

    if (t.flags & 2) {
      c.save();
      c.globalAlpha = alpha * (0.55 + Math.sin(time * 8) * 0.15);
      c.strokeStyle = '#7fe3ff';
      c.lineWidth = 2.5;
      c.shadowColor = '#7fe3ff'; c.shadowBlur = 12;
      c.beginPath(); c.arc(t.x, t.y, 25, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(127,227,255,0.08)';
      c.fill();
      c.restore();
    }
  }

  function drawIcon(c, k, s) {
    c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = c.fillStyle = '#fff';
    c.beginPath();
    switch (k) {
      case 'heal': c.fillRect(-2.5 * s, -7 * s, 5 * s, 14 * s); c.fillRect(-7 * s, -2.5 * s, 14 * s, 5 * s); return;
      case 'shield': c.moveTo(0, -8 * s); c.lineTo(7 * s, -5 * s); c.lineTo(6 * s, 3 * s); c.lineTo(0, 8 * s); c.lineTo(-6 * s, 3 * s); c.lineTo(-7 * s, -5 * s); c.closePath(); c.fill(); return;
      case 'rapid': c.moveTo(2 * s, -9 * s); c.lineTo(-5 * s, 1 * s); c.lineTo(0, 1 * s); c.lineTo(-2 * s, 9 * s); c.lineTo(5 * s, -1 * s); c.lineTo(0, -1 * s); c.closePath(); c.fill(); return;
      case 'triple': for (const a of [-0.45, 0, 0.45]) { c.moveTo(-6 * s * Math.cos(a), 6 * s); c.lineTo(Math.sin(a) * 9 * s, -7 * s); } c.stroke(); return;
      case 'rail': c.moveTo(-8 * s, 6 * s); c.lineTo(8 * s, -6 * s); c.stroke(); c.beginPath(); c.arc(6 * s, -4.5 * s, 3 * s, 0, Math.PI * 2); c.fill(); return;
      case 'mines': c.arc(0, 0, 5 * s, 0, Math.PI * 2); c.fill(); for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; c.moveTo(Math.cos(a) * 5 * s, Math.sin(a) * 5 * s); c.lineTo(Math.cos(a) * 8.5 * s, Math.sin(a) * 8.5 * s); } c.stroke(); return;
      case 'speed': c.moveTo(-6 * s, -6 * s); c.lineTo(0, 0); c.lineTo(-6 * s, 6 * s); c.moveTo(1 * s, -6 * s); c.lineTo(7 * s, 0); c.lineTo(1 * s, 6 * s); c.stroke(); return;
    }
  }

  function drawPowerup(c, u) {
    const col = PU_COLOR[u.k] || '#fff';
    const bob = Math.sin(time * 3 + u.id) * 2.5;
    c.save();
    c.translate(u.x, u.y + bob);
    const gr = c.createRadialGradient(0, 0, 2, 0, 0, 26);
    gr.addColorStop(0, rgba(col, 0.55)); gr.addColorStop(1, rgba(col, 0));
    c.fillStyle = gr;
    c.beginPath(); c.arc(0, 0, 26, 0, Math.PI * 2); c.fill();
    c.rotate(Math.sin(time * 1.5 + u.id) * 0.25);
    c.fillStyle = 'rgba(10,14,20,0.85)';
    rr(c, -13, -13, 26, 26, 6); c.fill();
    c.strokeStyle = col; c.lineWidth = 2;
    rr(c, -13, -13, 26, 26, 6); c.stroke();
    c.fillStyle = col;
    drawIcon(c, u.k, 1);
    c.restore();
  }

  function drawMine(c, m, mine, mineTeam, color) {
    c.save();
    c.translate(m.x, m.y);
    const armed = m.armed;
    const alpha = mine ? (armed ? 0.55 : 0.9) : armed && !mineTeam ? 1 : 0.9;
    c.globalAlpha = alpha;
    c.fillStyle = '#1b1d20';
    c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#555'; c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      c.beginPath(); c.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); c.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); c.stroke();
    }
    c.strokeStyle = color; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 6.5, 0, Math.PI * 2); c.stroke();
    const enemy = !mine && !mineTeam;
    const blink = enemy && armed ? (Math.sin(time * 18) > 0 ? 1 : 0.2) : armed ? (Math.sin(time * 4) > 0.6 ? 1 : 0.25) : 1;
    c.fillStyle = enemy && armed ? `rgba(255,40,40,${blink})` : armed ? `rgba(255,90,60,${blink})` : '#ffd84d';
    c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill();
    if (!armed) {
      c.strokeStyle = 'rgba(255,216,77,0.6)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, 0, 14 + Math.sin(time * 14) * 2, 0, Math.PI * 2); c.stroke();
    }
    if (enemy && armed) {
      c.strokeStyle = `rgba(255,50,50,${0.5 * blink})`; c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, 0, 18, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  function drawBullet(c, b, color) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const tl = b.kind === 1 ? 10 : 16;
    const tx = b.x - (b.vx / sp) * tl, ty = b.y - (b.vy / sp) * tl;
    const gr = c.createLinearGradient(tx, ty, b.x, b.y);
    gr.addColorStop(0, rgba(color, 0));
    gr.addColorStop(1, rgba(color, 0.8));
    c.strokeStyle = gr;
    c.lineWidth = b.kind === 1 ? 3 : 4.5;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(b.x, b.y); c.stroke();
    c.fillStyle = rgba(color, 0.35);
    c.beginPath(); c.arc(b.x, b.y, b.kind === 1 ? 5 : 7.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = b.bounces > 0 ? '#ffe2b0' : '#ffffff';
    c.beginPath(); c.arc(b.x, b.y, b.kind === 1 ? 2.4 : 3.4, 0, Math.PI * 2); c.fill();
    if (b.bounces > 0) {
      c.strokeStyle = 'rgba(255,90,60,0.8)'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(b.x, b.y, 6, 0, Math.PI * 2); c.stroke();
    }
  }

  function drawLabel(c, t, isMe, teamColor) {
    const y = t.y - 30;
    c.font = '700 12px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.strokeText(t.name, t.x, y);
    c.fillStyle = isMe ? '#ffe28a' : teamColor || '#ffffff';
    c.fillText(t.name, t.x, y);
    const w = 34, hp = Math.max(0, t.hp) / C.MAX_HP;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(t.x - w / 2 - 1, y + 4, w + 2, 6);
    c.fillStyle = hp > 0.6 ? '#5cff6e' : hp > 0.3 ? '#ffd84d' : '#ff4d4d';
    c.fillRect(t.x - w / 2, y + 5, w * hp, 4);
    if (t.shield > 0) {
      c.fillStyle = '#7fe3ff';
      c.fillRect(t.x - w / 2, y + 5, w * Math.min(1, t.shield / 60), 1.5);
    }
  }

  function drawBubble(c, x, y, text, a) {
    c.save();
    c.globalAlpha = a;
    c.font = '700 13px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    const w = c.measureText(text).width + 14;
    c.fillStyle = 'rgba(255,255,255,0.95)';
    rr(c, x - w / 2, y - 58, w, 22, 8); c.fill();
    c.beginPath(); c.moveTo(x - 5, y - 37); c.lineTo(x + 5, y - 37); c.lineTo(x, y - 31); c.fill();
    c.fillStyle = '#111';
    c.textAlign = 'center';
    c.fillText(text, x, y - 42);
    c.restore();
  }

  function stampTreads(t) {
    let tr = treads.get(t.id);
    if (!tr) { tr = { x: t.x, y: t.y, acc: 0, dist: 0 }; treads.set(t.id, tr); }
    const d = Math.hypot(t.x - tr.x, t.y - tr.y);
    if (d > 60) { tr.x = t.x; tr.y = t.y; return tr.dist; }
    tr.acc += d; tr.dist += d; tr.x = t.x; tr.y = t.y;
    if (tr.acc > 7 && decalCtx) {
      tr.acc = 0;
      const c = Math.cos(t.ha), s = Math.sin(t.ha);
      decalCtx.fillStyle = 'rgba(0,0,0,0.16)';
      for (const off of [-11.5, 11.5]) {
        decalCtx.save();
        decalCtx.translate(t.x - s * off, t.y + c * off);
        decalCtx.rotate(t.ha);
        decalCtx.fillRect(-3, -3.5, 6, 7);
        decalCtx.restore();
      }
    }
    return tr.dist;
  }

  // ---------------------------------------------------------------- 一幀
  function frame(st, dt) {
    time += dt;
    if (!map) return;
    if (groundDirty) buildGround();
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#07090c';
    c.fillRect(0, 0, cv.width, cv.height);

    shake *= Math.exp(-dt * 9);
    const sx = (Math.random() - 0.5) * shake * 2, sy = (Math.random() - 0.5) * shake * 2;
    const sc = view.s * dpr;
    c.setTransform(sc, 0, 0, sc, (view.ox + sx) * dpr, (view.oy + sy) * dpr);

    c.drawImage(groundCv, 0, 0, W, H);
    decalFadeT += dt;
    if (decalFadeT > 0.5) {
      decalFadeT = 0;
      decalCtx.globalCompositeOperation = 'destination-out';
      decalCtx.fillStyle = 'rgba(0,0,0,0.03)';
      decalCtx.fillRect(0, 0, W, H);
      decalCtx.globalCompositeOperation = 'source-over';
    }
    c.drawImage(decalCv, 0, 0);

    // 水波
    c.strokeStyle = 'rgba(150,215,255,0.22)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (const [x, y] of waterTiles) {
      for (let i = 0; i < 2; i++) {
        const yy = y + 12 + i * 16 + Math.sin(time * 2 + x * 0.05 + i) * 3;
        const ph = (time * 14 + i * 13 + y) % 40;
        c.moveTo(x + 4 + ph * 0.3, yy); c.lineTo(x + 18 + ph * 0.3, yy);
      }
    }
    c.stroke();

    for (const u of st.powerups) drawPowerup(c, u);
    for (const m of st.mines) drawMine(c, m, m.mine, m.team, m.color);

    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      g.life -= dt;
      if (g.life <= 0) { ghosts.splice(i, 1); continue; }
      drawTank(c, g, (g.life / g.max) * 0.35);
    }

    for (const t of st.tanks) {
      t.dist = stampTreads(t);
      let a = 1;
      if (t.flags & 1) a = Math.sin(time * 25) > 0 ? 0.9 : 0.35;
      drawTank(c, t, a);
      if ((t.flags & 4) && Math.random() < 0.5) {
        const back = t.ha + Math.PI;
        P({ x: t.x + Math.cos(back) * 18, y: t.y + Math.sin(back) * 18, vx: Math.cos(back) * 60 + rand(-20, 20), vy: Math.sin(back) * 60 + rand(-20, 20), life: 0.25, r: 4, r1: 1, c: 'rgba(100,180,255,0.8)', add: true });
      }
      if (t.hp < 35 && Math.random() < 0.25) smoke(t.x, t.y, 1, 9, 0.9, 'rgba(40,40,40,0.5)');
    }

    for (const b of st.bullets) drawBullet(c, b, b.color);

    c.globalAlpha = 0.94;
    c.drawImage(bushCv, 0, 0, W, H);
    c.globalAlpha = 1;
    for (const t of st.tanks) if ((t.flags & 64) && (t.me || t.ally)) drawTank(c, t, 0.4);

    // 雷射
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.life -= dt;
      if (b.life <= 0) { beams.splice(i, 1); continue; }
      const k = b.life / b.max;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const [w, col] of [[14 * k, rgba(b.c, 0.25 * k)], [6 * k, rgba(b.c, 0.7 * k)], [2.2, `rgba(255,255,255,${k})`]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath();
        b.pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
      }
      c.restore();
    }

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const f = Math.exp(-p.drag * dt);
      p.vx *= f; p.vy *= f;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (const pass of [false, true]) {
      c.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (const p of particles) {
        if (!!p.add !== pass) continue;
        const k = p.life / p.max;
        const r = p.r1 + (p.r - p.r1) * k;
        c.globalAlpha = Math.min(1, k * 1.4);
        c.fillStyle = p.c;
        if (p.kind === 'line') {
          c.strokeStyle = p.c; c.lineWidth = r;
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); c.stroke();
        } else if (p.kind === 'sq') {
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-r, -r, r * 2, r * 2); c.restore();
        } else {
          c.beginPath(); c.arc(p.x, p.y, Math.max(0.1, r), 0, Math.PI * 2); c.fill();
        }
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.life -= dt;
      if (g.life <= 0) { rings.splice(i, 1); continue; }
      const k = g.life / g.max;
      c.strokeStyle = `rgba(${g.c},${k})`;
      c.lineWidth = g.w * (0.4 + k);
      c.beginPath(); c.arc(g.x, g.y, g.r1 + (g.r0 - g.r1) * k, 0, Math.PI * 2); c.stroke();
    }

    for (const t of st.tanks) drawLabel(c, t, t.me, t.teamColor);
    for (const b of st.bubbles) drawBubble(c, b.x, b.y, b.text, b.a);

    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      const k = f.life / f.max;
      f.y -= 32 * dt;
      c.globalAlpha = Math.min(1, k * 2);
      c.font = `900 ${f.size * (1 + (1 - k) * 0.15)}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 3.5; c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.c;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;

    // 瞄準線與準星
    if (st.aim) drawAim(c, st.aim, dt);

    if (st.dim) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(0, 0, cv.width, cv.height);
    }

    // 受傷紅框
    c.setTransform(1, 0, 0, 1, 0, 0);
    hurtFlash = Math.max(0, hurtFlash - dt * 1.6);
    const lowHp = st.lowHp ? 0.18 + Math.sin(time * 6) * 0.08 : 0;
    const vig = Math.max(hurtFlash, lowHp);
    if (vig > 0.01) {
      const w = cv.width, h = cv.height;
      const gr = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(255,0,0,0)');
      gr.addColorStop(1, `rgba(220,0,0,${vig})`);
      c.fillStyle = gr;
      c.fillRect(0, 0, w, h);
    }
    killFlash = Math.max(0, killFlash - dt);
    if (killFlash > 0) {
      c.fillStyle = `rgba(255,220,120,${killFlash * 0.25})`;
      c.fillRect(0, 0, cv.width, cv.height);
    }
  }

  function drawAim(c, aim, dt) {
    hitMarker = Math.max(0, hitMarker - dt);
    const { x, y, from, ammo, ammoT, maxAmmo, rail, rapid } = aim;
    if (from) {
      const a = Math.atan2(y - from.y, x - from.x);
      const res = Core.castRay(map, from.x, from.y, a, 1400, 1, false);
      c.save();
      c.setLineDash([4, 7]);
      c.lineWidth = 1.5;
      c.strokeStyle = rail ? 'rgba(255,110,199,0.35)' : 'rgba(255,255,255,0.16)';
      c.beginPath();
      const p0 = res.pts[0], p1 = res.pts[1];
      c.moveTo(p0[0] + Math.cos(a) * 26, p0[1] + Math.sin(a) * 26);
      c.lineTo(p1[0], p1[1]);
      c.stroke();
      if (res.pts.length > 2) {
        const p2 = res.pts[2];
        const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
        const k = Math.min(1, 70 / L);
        const gr = c.createLinearGradient(p1[0], p1[1], p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k);
        gr.addColorStop(0, rail ? 'rgba(255,110,199,0.35)' : 'rgba(255,200,120,0.3)');
        gr.addColorStop(1, 'rgba(255,200,120,0)');
        c.strokeStyle = gr;
        c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k); c.stroke();
        c.setLineDash([]);
        c.fillStyle = 'rgba(255,200,120,0.45)';
        c.beginPath(); c.arc(p1[0], p1[1], 2.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    // 準星（外圈顯示彈藥）
    c.save();
    c.translate(x, y);
    c.lineWidth = 2;
    c.strokeStyle = hitMarker > 0 ? '#ff4d4d' : '#ffffff';
    c.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(dx * 4, dy * 4); c.lineTo(dx * 9, dy * 9); }
    c.stroke();
    if (hitMarker > 0) {
      c.lineWidth = 2.5;
      c.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(dx * 6, dy * 6); c.lineTo(dx * 13, dy * 13); }
      c.stroke();
    }
    if (maxAmmo) {
      const n = maxAmmo, gap = 0.18, seg = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * seg + gap / 2, a1 = a0 + seg - gap;
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(255,255,255,0.15)';
        c.beginPath(); c.arc(0, 0, 16, a0, a1); c.stroke();
        let fill = rapid ? 1 : i < ammo ? 1 : i === ammo ? ammoT : 0;
        if (fill > 0) {
          c.strokeStyle = rail ? '#ff6ec7' : rapid ? '#ffb142' : i < ammo ? '#ffd84d' : 'rgba(255,216,77,0.5)';
          c.beginPath(); c.arc(0, 0, 16, a0, a0 + (a1 - a0) * fill); c.stroke();
        }
      }
    }
    c.restore();
  }

  return { init, resize, setMap, tileChanged, frame, toWorld, fx, view, PU_COLOR, get map() { return map; } };
})();
