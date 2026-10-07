/* 繪圖：地圖預先繪製、鏡頭跟隨、小地圖、坦克外觀、砲彈、模式目標、粒子特效、畫面震動 */
const Render = (() => {
  const { TILE, T, C, PAD_DIR } = Core;
  let cv, ctx, dpr = 1;
  // s：世界→螢幕縮放；ox/oy：世界原點在螢幕上的位置；follow：鏡頭是否跟著自己
  const view = { s: 1, ox: 0, oy: 0, cw: 0, ch: 0, top: 0, avail: 0, follow: false, fitS: 1 };
  const cam = { x: 640, y: 400, snap: true };
  let camMode = 'auto', spectate = false, hiQ = true;
  let map = null, W = 0, H = 0, theme = null;
  let groundCv = null, bushCv = null, decalCv = null, decalCtx = null, miniCv = null;
  let groundDirty = true, miniDirty = true, decalFadeT = 0, lastMiniH = -1;
  let waterTiles = [], lavaTiles = [], portals = [], pads = [];
  const particles = [], rings = [], beams = [], floaters = [], ghosts = [], planes = [];
  const treads = new Map();
  let shake = 0, hurtFlash = 0, hitMarker = 0, time = 0, killFlash = 0, goldFlash = 0;
  let touchMode = false, ls = 1; // ls：文字放大倍率（地圖縮很小時，名字和數字要放大才看得到）
  // 小地圖：可以在選單關掉；有坦克開到小地圖底下時會變得更透明
  let miniOn = true, miniFade = 0.6;
  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

  const PU_COLOR = {
    heal: '#5cff6e', shield: '#7fe3ff', rapid: '#ffb142', triple: '#ffd84d', rail: '#ff6ec7', mines: '#ff5a3d', speed: '#4da6ff',
    homing: '#9dff5c', shotgun: '#ffcf6e', flame: '#ff7a2e', cloak: '#b8a6ff', bounce: '#3dfcff', supply: '#a3e635', crate: '#ffb300',
  };
  // 不同坦克種類的車身比例（整台還會再依半徑縮放）
  const SHAPES = {
    medium: { trk: 9, hull: [-15, -11, 30, 22], top: [-13, -9, 26, 18], tur: 10, bw: 6, bl: 20 },
    heavy: { trk: 10, hull: [-16, -12, 32, 24], top: [-14, -10, 28, 20], tur: 11.5, bw: 8, bl: 21, skirt: true, brake: true },
    light: { trk: 7, hull: [-14, -9.5, 28, 19], top: [-12, -7.5, 24, 15], tur: 7.5, bw: 4.5, bl: 18, antenna: true },
    spg: { trk: 9, hull: [-15, -11, 30, 22], top: [-13, -9, 26, 18], tur: 0, bw: 9, bl: 13, box: true },
    td: { trk: 8.5, hull: [-16, -10.5, 32, 21], top: [-14, -8.5, 28, 17], tur: 0, bw: 5, bl: 30, wedge: true, brake: true },
  };
  const TEAM_COLORS = ['#ff5252', '#448aff'];
  const PORTAL_COLORS = ['#b388ff', '#4dd0e1', '#ffca28', '#ff8a65'];

  // 地圖風格：a/b 地板棋盤格、fleck 地面斑點、bush 草叢四色（陰影、深、淺、亮點）
  const THEMES = {
    grass: { a: '#2b3427', b: '#283124', fleck: ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.12)'], grid: 'rgba(0,0,0,0.16)', shadow: 'rgba(0,0,0,0.38)', bush: ['#1f5a22', '#2f7d32', '#3a9140', 'rgba(180,255,150,0.18)'], bg: '#07090c', water: '#123f61', ice: '#7fb8d6', steelTop: '#8e98a5' },
    jungle: { a: '#20301e', b: '#1d2b1b', fleck: ['rgba(140,200,90,0.06)', 'rgba(0,0,0,0.16)'], grid: 'rgba(0,0,0,0.14)', shadow: 'rgba(0,0,0,0.42)', bush: ['#164a1b', '#24692a', '#2f8034', 'rgba(170,255,140,0.16)'], bg: '#060906', water: '#0f3a4a', ice: '#7fb8d6', steelTop: '#8e98a5', deco: 'leaf' },
    metal: { a: '#2c3137', b: '#292e34', fleck: ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.14)'], grid: 'rgba(0,0,0,0.32)', shadow: 'rgba(0,0,0,0.4)', bush: ['#1f4f3a', '#2d6b4f', '#38805e', 'rgba(170,255,210,0.16)'], bg: '#07080a', water: '#12354f', ice: '#7fb8d6', steelTop: '#a3adb9', deco: 'plate' },
    desert: { a: '#5a4a32', b: '#56462f', fleck: ['rgba(255,235,190,0.08)', 'rgba(60,40,10,0.14)'], grid: 'rgba(60,40,10,0.14)', shadow: 'rgba(40,25,5,0.35)', bush: ['#4a5a1e', '#62762a', '#7a8f33', 'rgba(240,255,160,0.18)'], bg: '#0d0a06', water: '#1d5468', ice: '#8cc6dd', steelTop: '#a59f93', deco: 'sand' },
    factory: { a: '#2b2b2e', b: '#29292c', fleck: ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.18)'], grid: 'rgba(0,0,0,0.22)', shadow: 'rgba(0,0,0,0.42)', bush: ['#2a4a26', '#3a6334', '#477a40', 'rgba(200,255,170,0.14)'], bg: '#070707', water: '#1a3346', ice: '#7fb8d6', steelTop: '#8e98a5', deco: 'oil' },
    snow: { a: '#b8c5d1', b: '#b2bfcb', fleck: ['rgba(255,255,255,0.45)', 'rgba(70,95,120,0.08)'], grid: 'rgba(60,85,110,0.10)', shadow: 'rgba(40,60,85,0.28)', bush: ['#24503f', '#33694f', '#e9f4fb', 'rgba(255,255,255,0.55)'], bg: '#0b1016', water: '#2b6e93', ice: '#9fd3ec', steelTop: '#ffffff', light: true },
    neon: { a: '#15172b', b: '#131528', fleck: ['rgba(120,200,255,0.05)', 'rgba(0,0,0,0.2)'], grid: 'rgba(90,210,255,0.13)', shadow: 'rgba(0,0,0,0.5)', bush: ['#2a1f55', '#3d2b7a', '#5a3fb0', 'rgba(200,170,255,0.25)'], bg: '#05050c', water: '#0d2c5a', ice: '#6fb6e0', steelTop: '#5fe3ff', deco: 'neon' },
    lava: { a: '#2a2321', b: '#27201e', fleck: ['rgba(255,140,80,0.05)', 'rgba(0,0,0,0.22)'], grid: 'rgba(0,0,0,0.22)', shadow: 'rgba(0,0,0,0.45)', bush: ['#2e2a1a', '#4a4224', '#5c522c', 'rgba(255,200,120,0.12)'], bg: '#0b0605', water: '#123f61', ice: '#7fb8d6', steelTop: '#6e5f58', deco: 'ash',
      steel: { base: '#463b38', low: '#241c1a', inner: '#52453f', line: 'rgba(255,110,40,0.28)', rivet: '#7d6a60' } },
    asphalt: { a: '#2f3135', b: '#2d2f33', fleck: ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.16)'], grid: 'rgba(0,0,0,0)', shadow: 'rgba(0,0,0,0.4)', bush: ['#1f5a22', '#2f7d32', '#3a9140', 'rgba(180,255,150,0.18)'], bg: '#08090a', water: '#123f61', ice: '#7fb8d6', steelTop: '#c8ccd2', deco: 'lane' },
  };
  theme = THEMES.grass;

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
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
  }
  function hslHex(h, s, l) {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
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

  // ---------------------------------------------------------------- 版面與鏡頭
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    addEventListener('resize', resize);
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, hiQ ? 2 : 1);
    view.cw = innerWidth; view.ch = innerHeight;
    cv.width = Math.round(view.cw * dpr);
    cv.height = Math.round(view.ch * dpr);
    layout();
  }
  function layout() {
    if (!map) return;
    const top = touchMode ? 30 : view.ch > 600 ? 52 : 40, bottom = touchMode ? 4 : view.ch > 600 ? 76 : 56;
    view.top = top;
    view.avail = Math.max(120, view.ch - top - bottom);
    view.fitS = Math.min((view.cw - 8) / W, view.avail / H);
    // 手機上整張地圖縮太小時改成鏡頭跟著自己（可以在選單切換）；鏡頭跟隨時大約看得到 520px 高的範圍
    const wantFollow = !spectate && (camMode === 'follow' || (camMode === 'auto' && view.fitS < 0.62));
    let s = view.fitS, follow = false;
    if (wantFollow) {
      const fs = Math.max(view.fitS, Math.min(1.8, view.avail / 520));
      if (fs > view.fitS * 1.05) { s = fs; follow = true; }
    }
    if (Math.abs(s - view.s) > 1e-4 || !groundCv) groundDirty = true;
    view.s = s;
    view.follow = follow;
    ls = Math.min(2.4, Math.max(1, 0.85 / view.s));
    if (!view.follow) { view.ox = (view.cw - W * view.s) / 2; view.oy = top + (view.avail - H * view.s) / 2; }
    cam.snap = true;
  }
  const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
  const toScreen = (x, y) => ({ x: x * view.s + view.ox, y: y * view.s + view.oy });

  function updateCamera(target, dt) {
    if (!view.follow) return;
    const s = view.s, visW = view.cw / s, visH = view.avail / s;
    if (target) {
      if (cam.snap) { cam.x = target.x; cam.y = target.y; cam.snap = false; }
      else { const k = 1 - Math.exp(-dt * 7); cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; }
    }
    const cx = W <= visW ? W / 2 : Core.clamp(cam.x, visW / 2, W - visW / 2);
    const cy = H <= visH ? H / 2 : Core.clamp(cam.y, visH / 2, H - visH / 2);
    view.ox = view.cw / 2 - cx * s;
    view.oy = view.top + view.avail / 2 - cy * s;
  }

  function setMap(m) {
    map = m;
    W = m.w * TILE; H = m.h * TILE;
    theme = THEMES[m.theme] || THEMES.grass;
    decalCv = document.createElement('canvas');
    decalCv.width = W; decalCv.height = H;
    decalCtx = decalCv.getContext('2d');
    treads.clear();
    particles.length = rings.length = beams.length = floaters.length = ghosts.length = planes.length = 0;
    // 傳送門配對上色、加速帶清單
    portals = []; pads = [];
    let pair = 0;
    const seen = new Set();
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      const tx = i % m.w, ty = (i / m.w) | 0;
      if (t === T.PORTAL && !seen.has(i)) {
        const [px, py] = Core.portalPartner(m, tx, ty);
        const j = py * m.w + px;
        seen.add(i); seen.add(j);
        const col = PORTAL_COLORS[pair++ % PORTAL_COLORS.length];
        portals.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, c: col }, { x: px * TILE + TILE / 2, y: py * TILE + TILE / 2, c: col });
      }
      if (PAD_DIR[t]) pads.push({ x: tx * TILE, y: ty * TILE, d: PAD_DIR[t] });
    }
    miniDirty = true;
    groundDirty = true;
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
    waterTiles = []; lavaTiles = [];
    const th = theme;
    const tileAt = (tx, ty) => Core.tileAt(map, tx, ty);

    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const x = tx * TILE, y = ty * TILE;
        g.fillStyle = (tx + ty) & 1 ? th.a : th.b;
        g.fillRect(x, y, TILE, TILE);
        for (let i = 0; i < 4; i++) {
          g.fillStyle = hash(tx, ty, i) > 0.5 ? th.fleck[0] : th.fleck[1];
          const s = 2 + hash(tx, ty, i + 9) * 4;
          g.fillRect(x + hash(tx, ty, i + 3) * 36, y + hash(tx, ty, i + 6) * 36, s, s);
        }
        // 主題裝飾
        if (th.deco === 'leaf' && hash(tx, ty, 50) > 0.6) {
          g.fillStyle = 'rgba(30,60,20,0.5)';
          g.beginPath(); g.ellipse(x + hash(tx, ty, 51) * 32 + 4, y + hash(tx, ty, 52) * 32 + 4, 5, 2.2, hash(tx, ty, 53) * 6, 0, Math.PI * 2); g.fill();
        } else if (th.deco === 'plate' && (tx + ty * 3) % 4 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.05)';
          for (const [rx, ry] of [[4, 4], [36, 4], [4, 36], [36, 36]]) { g.beginPath(); g.arc(x + rx, y + ry, 1.4, 0, Math.PI * 2); g.fill(); }
        } else if (th.deco === 'sand' && hash(tx, ty, 54) > 0.55) {
          g.strokeStyle = 'rgba(255,230,180,0.08)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x + 4, y + 20); g.quadraticCurveTo(x + 20, y + 12 + hash(tx, ty, 55) * 16, x + 36, y + 20); g.stroke();
        } else if (th.deco === 'oil' && hash(tx, ty, 56) > 0.88) {
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.beginPath(); g.ellipse(x + 20, y + 20, 9 + hash(tx, ty, 57) * 8, 6 + hash(tx, ty, 58) * 5, hash(tx, ty, 59) * 3, 0, Math.PI * 2); g.fill();
        } else if (th.deco === 'ash' && hash(tx, ty, 60) > 0.8) {
          g.strokeStyle = 'rgba(255,90,30,0.2)'; g.lineWidth = 1.2;
          const sx = x + 4 + hash(tx, ty, 61) * 10, sy = y + 6 + hash(tx, ty, 62) * 28;
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 9, sy - 4 + hash(tx, ty, 63) * 8); g.lineTo(sx + 17, sy - 2 + hash(tx, ty, 64) * 6); g.lineTo(sx + 26, sy - 5 + hash(tx, ty, 65) * 10); g.stroke();
        }
      }
    }
    if (th.grid !== 'rgba(0,0,0,0)') {
      g.strokeStyle = th.grid;
      g.lineWidth = th.deco === 'neon' ? 1.2 : 1;
      g.beginPath();
      for (let x = 0; x <= W; x += TILE) { g.moveTo(x, 0); g.lineTo(x, H); }
      for (let y = 0; y <= H; y += TILE) { g.moveTo(0, y); g.lineTo(W, y); }
      g.stroke();
    }
    if (th.deco === 'lane') {
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.setLineDash([14, 12]);
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      g.setLineDash([]);
    }

    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[ty * map.w + tx];
      const x = tx * TILE, y = ty * TILE;
      if (t === T.WATER) {
        g.fillStyle = th.water;
        g.fillRect(x, y, TILE, TILE);
        const edge = (dx, dy) => tileAt(tx + dx, ty + dy) !== T.WATER;
        g.fillStyle = th.light ? 'rgba(255,255,255,0.6)' : 'rgba(160,210,170,0.35)';
        if (edge(0, -1)) g.fillRect(x, y, TILE, 3);
        if (edge(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
        if (edge(-1, 0)) g.fillRect(x, y, 3, TILE);
        if (edge(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
        waterTiles.push([x, y]);
      } else if (t === T.ICE) drawIce(g, x, y, tx, ty);
      else if (t === T.LAVA) drawLava(g, x, y, tx, ty);
      else if (t === T.PORTAL) {
        const gr = g.createRadialGradient(x + 20, y + 20, 2, x + 20, y + 20, 19);
        gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.75, 'rgba(10,0,30,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x + 20, y + 20, 19, 0, Math.PI * 2); g.fill();
      } else if (PAD_DIR[t]) {
        g.fillStyle = '#1b1e23';
        rr(g, x + 2, y + 2, TILE - 4, TILE - 4, 5); g.fill();
        g.strokeStyle = 'rgba(255,200,60,0.35)'; g.lineWidth = 1.5;
        rr(g, x + 2.5, y + 2.5, TILE - 5, TILE - 5, 5); g.stroke();
      }
    }

    // 岩漿把旁邊的地面照紅
    if (lavaTiles.length) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const [x, y] of lavaTiles) {
        const gl = g.createRadialGradient(x + 20, y + 20, 14, x + 20, y + 20, 42);
        gl.addColorStop(0, 'rgba(255,90,20,0.16)'); gl.addColorStop(1, 'rgba(255,90,20,0)');
        g.fillStyle = gl;
        g.fillRect(x - 24, y - 24, TILE + 48, TILE + 48);
      }
      g.restore();
    }

    // 陰影
    g.fillStyle = th.shadow;
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

  function drawIce(g, x, y, tx, ty) {
    const th = theme;
    g.fillStyle = th.ice;
    g.fillRect(x, y, TILE, TILE);
    const gr = g.createLinearGradient(x, y, x + TILE, y + TILE);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.02)'); gr.addColorStop(1, 'rgba(255,255,255,0.14)');
    g.fillStyle = gr;
    g.fillRect(x, y, TILE, TILE);
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 2; i++) {
      const sx = x + hash(tx, ty, 70 + i) * 30, sy = y + hash(tx, ty, 80 + i) * 30;
      g.moveTo(sx, sy); g.lineTo(sx + 8 + hash(tx, ty, 90 + i) * 6, sy - 6);
    }
    g.stroke();
    if (hash(tx, ty, 99) > 0.8) {
      g.strokeStyle = 'rgba(40,90,120,0.35)';
      g.beginPath(); g.moveTo(x + 6, y + 30); g.lineTo(x + 16, y + 22); g.lineTo(x + 14, y + 12); g.lineTo(x + 26, y + 6); g.stroke();
    }
    const edge = (dx, dy) => Core.tileAt(map, tx + dx, ty + dy) !== T.ICE;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    if (edge(0, -1)) g.fillRect(x, y, TILE, 2);
    if (edge(-1, 0)) g.fillRect(x, y, 2, TILE);
    g.fillStyle = 'rgba(30,70,100,0.25)';
    if (edge(0, 1)) g.fillRect(x, y + TILE - 2, TILE, 2);
    if (edge(1, 0)) g.fillRect(x + TILE - 2, y, 2, TILE);
  }

  // 岩漿：亮橘紅底、冷掉的黑色岩塊、跟地面交界有一圈焦黑的邊（會動的光和泡泡在 frame() 畫）
  function drawLava(g, x, y, tx, ty) {
    const gr = g.createRadialGradient(x + 20, y + 20, 3, x + 20, y + 20, 30);
    gr.addColorStop(0, '#ffb347'); gr.addColorStop(0.55, '#ff6a1a'); gr.addColorStop(1, '#c2370c');
    g.fillStyle = gr;
    g.fillRect(x, y, TILE, TILE);
    for (let i = 0; i < 3; i++) {
      const cx = x + 7 + hash(tx, ty, 200 + i) * 26, cy = y + 7 + hash(tx, ty, 210 + i) * 26, r = 3 + hash(tx, ty, 220 + i) * 4.5;
      g.fillStyle = 'rgba(70,22,8,0.6)';
      g.beginPath(); g.ellipse(cx, cy, r * 1.35, r, hash(tx, ty, 230 + i) * 3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,220,120,0.5)'; g.lineWidth = 0.8; g.stroke();
    }
    const edge = (dx, dy) => Core.tileAt(map, tx + dx, ty + dy) !== T.LAVA;
    g.fillStyle = '#2a120a';
    if (edge(0, -1)) g.fillRect(x, y, TILE, 3);
    if (edge(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
    if (edge(-1, 0)) g.fillRect(x, y, 3, TILE);
    if (edge(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
    lavaTiles.push([x, y, tx, ty]);
  }

  const STEEL_DEF = { base: '#5b6470', low: '#373e47', inner: '#6a7480', line: 'rgba(0,0,0,0.35)', rivet: '#aab3be' };
  const STEEL_NEON = { base: '#272b45', low: '#14172b', inner: '#30355a', line: 'rgba(95,227,255,0.35)', rivet: '#5fe3ff' };
  function drawSteel(g, x, y, tx, ty) {
    const S = (dx, dy) => Core.tileAt(map, tx + dx, ty + dy) === T.STEEL;
    const th = theme;
    const sc = th.steel || (th.deco === 'neon' ? STEEL_NEON : STEEL_DEF);
    g.fillStyle = sc.base;
    g.fillRect(x, y, TILE, TILE);
    g.fillStyle = th.steelTop;
    const cap = th.light ? 5 : 3;
    if (!S(0, -1)) g.fillRect(x, y, TILE, cap);
    if (!S(-1, 0)) g.fillRect(x, y, 3, TILE);
    g.fillStyle = sc.low;
    if (!S(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
    if (!S(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
    g.fillStyle = sc.inner;
    g.fillRect(x + 8, y + 8, TILE - 16, TILE - 16);
    g.strokeStyle = sc.line;
    g.lineWidth = 1;
    g.strokeRect(x + 8.5, y + 8.5, TILE - 17, TILE - 17);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(x + 8, y + 8); g.lineTo(x + TILE - 8, y + 8); g.lineTo(x + 8, y + TILE - 8); g.fill();
    g.fillStyle = sc.rivet;
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
    if (theme.light) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(x, y, TILE, 4); }
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
    const [c0, c1, c2, c3] = theme.bush;
    for (let i = 0; i < 6; i++) {
      const px = x + 6 + hash(tx, ty, i) * 28, py = y + 6 + hash(tx, ty, i + 20) * 28;
      const r = 10 + hash(tx, ty, i + 40) * 6;
      b.fillStyle = c0;
      b.beginPath(); b.arc(px, py, r, 0, Math.PI * 2); b.fill();
    }
    for (let i = 0; i < 6; i++) {
      const px = x + 6 + hash(tx, ty, i) * 28, py = y + 6 + hash(tx, ty, i + 20) * 28;
      const r = 10 + hash(tx, ty, i + 40) * 6;
      b.fillStyle = theme.light ? (i % 3 === 0 ? c2 : c1) : i % 2 ? c1 : c2;
      b.beginPath(); b.arc(px - 2, py - 2, r - 3, 0, Math.PI * 2); b.fill();
      b.fillStyle = c3;
      b.beginPath(); b.arc(px - 4, py - 4, r * 0.35, 0, Math.PI * 2); b.fill();
    }
  }

  function buildMini() {
    miniDirty = false;
    miniCv = miniCv || document.createElement('canvas');
    miniCv.width = map.w; miniCv.height = map.h;
    const m = miniCv.getContext('2d');
    const col = { [T.STEEL]: '#8a94a1', [T.BRICK]: '#a0522d', [T.WATER]: '#1f6aa5', [T.BUSH]: '#2f7d32', [T.BARREL]: '#e0442f', [T.ICE]: '#a8dcf0', [T.PORTAL]: '#b388ff', [T.LAVA]: '#ff5a1f' };
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      m.fillStyle = col[t] || (PAD_DIR[t] ? '#c9a227' : theme.light ? '#8d9aa6' : '#3a4236');
      m.fillRect(x, y, 1, 1);
    }
  }

  // ---------------------------------------------------------------- 粒子
  function P(p) {
    if (!hiQ && Math.random() < 0.45) return;
    if (particles.length > (hiQ ? 1600 : 600)) particles.splice(0, 200);
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
  // 火焰：粒子大約飛到 C.FLAME_RANGE（230px）那麼遠
  function flameBurst(x, y, a, n) {
    for (let i = 0; i < n; i++) {
      const ang = a + (Math.random() - 0.5) * 0.62, sp = rand(420, 620);
      P({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(0.42, 0.58), r: rand(2.5, 4), r1: rand(13, 21), c: Math.random() < 0.5 ? 'rgba(255,150,40,0.75)' : 'rgba(255,220,90,0.7)', add: true, drag: 1.6 });
    }
    if (Math.random() < 0.35) P({ x: x + Math.cos(a) * 170, y: y + Math.sin(a) * 170, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.6, r: 7, r1: 19, c: 'rgba(60,50,45,0.35)', drag: 1.5 });
  }

  const fx = {
    shot(x, y, a, color, kind) {
      if (kind === 2) {
        smoke(x, y, 6, 12, 0.7, 'rgba(200,200,200,0.35)');
        P({ x, y, vx: 0, vy: 0, life: 0.1, r: 14, r1: 4, c: 'rgba(200,255,160,0.9)', add: true });
        return;
      }
      if (kind === 3) {
        sparks(x, y, 14, '#ffd27a', 520, 0.2, a, 0.8);
        P({ x, y, vx: 0, vy: 0, life: 0.09, r: 20, r1: 5, c: 'rgba(255,230,160,0.95)', add: true });
        smoke(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 6, 14, 0.6, 'rgba(140,140,140,0.35)');
        return;
      }
      if (kind === 4) {
        // 自走砲：往上拋射，大團砲口煙
        P({ x, y, vx: 0, vy: 0, life: 0.12, r: 22, r1: 6, c: 'rgba(255,220,140,0.95)', add: true });
        sparks(x, y, 10, '#ffcf7a', 300, 0.25, a, 1.2);
        smoke(x, y, 9, 18, 1.1, 'rgba(150,145,140,0.4)');
        rings.push({ x, y, r0: 6, r1: 34, life: 0.25, max: 0.25, c: '255,230,180', w: 3 });
        shake = Math.min(22, shake + 1);
        return;
      }
      if (kind === 5) {
        // 驅逐戰車：細長的高速砲口焰
        for (let i = 0; i < 3; i++) P({ x: x + Math.cos(a) * i * 9, y: y + Math.sin(a) * i * 9, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.08, r: 11 - i * 3, r1: 2, c: 'rgba(210,245,255,0.95)', add: true });
        sparks(x, y, 9, '#c8f4ff', 640, 0.16, a, 0.35);
        smoke(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 4, 10, 0.6, 'rgba(150,160,170,0.35)');
        return;
      }
      if (kind === 6) {
        // 重坦：大砲口焰、比較多煙
        P({ x, y, vx: 0, vy: 0, life: 0.11, r: 19, r1: 5, c: 'rgba(255,225,150,0.95)', add: true });
        sparks(x, y, 10, '#ffc46a', 400, 0.2, a, 0.7);
        smoke(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6, 14, 0.8, 'rgba(110,105,100,0.4)');
        return;
      }
      sparks(x, y, kind ? 3 : 7, '#ffd27a', 380, 0.16, a, 0.6);
      P({ x, y, vx: 0, vy: 0, life: 0.08, r: kind ? 8 : 13, r1: 3, c: 'rgba(255,230,160,0.95)', add: true });
      if (!kind) smoke(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 3, 10, 0.5, 'rgba(120,120,120,0.35)');
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
    hit(x, y, dmg, shield, quiet) {
      sparks(x, y, quiet ? 2 : 8, shield ? '#7fe3ff' : '#ffb070', 260, 0.25);
      if (!quiet) floater(x, y - 22, '-' + dmg, shield ? '#7fe3ff' : '#ffffff', dmg >= 60 ? 22 : 16);
    },
    burnText(x, y, text) { floater(x, y - 26, text, '#ff9a3c', 15); },
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
    tankDeath(x, y, color, big) {
      debris(x, y, big ? 30 : 14, color, big ? 420 : 340);
      debris(x, y, 8, '#222', 260);
      smoke(x, y, big ? 12 : 6, big ? 34 : 22, 2.2, 'rgba(30,30,30,0.55)');
    },
    brick(i) {
      const x = (i % map.w) * TILE + TILE / 2, y = Math.floor(i / map.w) * TILE + TILE / 2;
      debris(x, y, 14, '#a85a33', 220);
      debris(x, y, 6, '#5b2c16', 160);
      smoke(x, y, 5, 18, 0.9, 'rgba(130,100,80,0.4)');
    },
    rail(segs, color) {
      beams.push({ segs, life: 0.45, max: 0.45, c: color });
      for (const pts of segs) for (let i = 1; i < pts.length; i++) sparks(pts[i][0], pts[i][1], 6, '#ffd0f0', 240, 0.25);
      shake = Math.min(22, shake + 4);
    },
    pickup(x, y, k, text) {
      const c = PU_COLOR[k] || '#ffffff';
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
    port(x, y, x2, y2) {
      const near = (px, py) => portals.reduce((b, p) => (Math.hypot(p.x - px, p.y - py) < Math.hypot(b.x - px, b.y - py) ? p : b), portals[0] || { x: px, y: py, c: '#b388ff' });
      for (const [px, py] of [[x, y], [x2, y2]]) {
        const c = near(px, py).c;
        rings.push({ x: px, y: py, r0: 6, r1: 40, life: 0.35, max: 0.35, c: hexRgb(c), w: 3 });
        sparks(px, py, 10, c, 260, 0.3);
      }
    },
    pad(x, y, a) {
      for (let i = 0; i < 6; i++) P({ x: x + rand(-10, 10), y: y + rand(-10, 10), vx: -Math.cos(a) * rand(80, 160), vy: -Math.sin(a) * rand(80, 160), life: 0.3, r: 2.5, r1: 0.5, c: 'rgba(255,210,80,0.8)', add: true, kind: 'line' });
    },
    fizzle(x, y) { smoke(x, y, 2, 6, 0.35, 'rgba(160,160,160,0.4)'); },
    mineArm(x, y, color) { rings.push({ x, y, r0: 4, r1: 22, life: 0.3, max: 0.3, c: hexRgb(color), w: 2 }); },
    puSpawn(x, y, k) { rings.push({ x, y, r0: 40, r1: 6, life: 0.5, max: 0.5, c: hexRgb(PU_COLOR[k] || '#ffffff'), w: 3 }); },
    flag(x, y, color, big) {
      rings.push({ x, y, r0: 6, r1: big ? 90 : 46, life: big ? 0.7 : 0.45, max: big ? 0.7 : 0.45, c: hexRgb(color), w: big ? 5 : 3 });
      sparks(x, y, big ? 40 : 14, color, big ? 420 : 240, big ? 0.7 : 0.4);
      if (big) for (let i = 0; i < 26; i++) P({ x, y, vx: rand(-260, 260), vy: rand(-320, 120), life: rand(0.8, 1.4), r: rand(2, 3.5), c: ['#ffd84d', '#ff6ec7', '#5cff6e', '#4da6ff', '#ffffff'][i % 5], kind: 'sq', rot: rand(0, 6), vr: rand(-10, 10), drag: 1.2 });
    },
    ring(x, y, color, r) { rings.push({ x, y, r0: 8, r1: r || 60, life: 0.5, max: 0.5, c: hexRgb(color), w: 3 }); },
    cloak(x, y) { rings.push({ x, y, r0: 30, r1: 8, life: 0.4, max: 0.4, c: '184,166,255', w: 2 }); sparks(x, y, 12, '#b8a6ff', 180, 0.4); },
    // 飛機飛過（k 0 運輸機丟空投、1 轟炸機）
    plane(x0, y0, x1, y1, T, k) { planes.push({ x0, y0, x1, y1, T, life: T, k }); },
    // 空投箱落地
    land(x, y) {
      rings.push({ x, y, r0: 6, r1: 44, life: 0.4, max: 0.4, c: '255,179,0', w: 3 });
      smoke(x, y, 7, 16, 0.9, 'rgba(160,140,110,0.4)');
      debris(x, y, 6, '#8a6a3a', 160);
    },
    hurt(amount) { hurtFlash = Math.min(0.75, hurtFlash + 0.25 + amount / 140); shake = Math.min(22, shake + 3 + amount / 12); },
    hitMarker() { hitMarker = 0.18; },
    killConfirm() { killFlash = 0.35; },
    levelUp() { goldFlash = 0.6; },
    shake(v) { shake = Math.min(22, shake + v); },
  };

  function tileChanged() { groundDirty = true; miniDirty = true; }

  // ---------------------------------------------------------------- 坦克外觀
  // 在車身上畫外觀圖案（已經 clip 在車身範圍內）
  function paintSkin(c, skin, color) {
    switch (skin) {
      case 'camo':
        c.fillStyle = shade(color, -0.4);
        for (const [x, y, rx, ry] of [[-8, -4, 6, 3.5], [4, 3, 7, 3], [9, -5, 4, 3], [-3, 5, 4, 2.5]]) { c.beginPath(); c.ellipse(x, y, rx, ry, 0.4, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = shade(color, 0.3);
        for (const [x, y, rx, ry] of [[-2, -6, 4, 2], [-11, 4, 3, 2.5], [10, 4, 3, 2]]) { c.beginPath(); c.ellipse(x, y, rx, ry, -0.3, 0, Math.PI * 2); c.fill(); }
        break;
      case 'stripe':
        c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2.4;
        c.beginPath();
        for (let x = -16; x <= 16; x += 6) { c.moveTo(x, -10); c.quadraticCurveTo(x + 3, 0, x - 1, 10); }
        c.stroke();
        break;
      case 'bolt':
        c.fillStyle = '#ffe14d';
        c.beginPath(); c.moveTo(-9, -6); c.lineTo(1, -6); c.lineTo(-2, -1); c.lineTo(9, -1); c.lineTo(-4, 8); c.lineTo(-1, 2); c.lineTo(-10, 2); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.8; c.stroke();
        break;
      case 'skull':
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.beginPath(); c.arc(-5, -1, 5, 0, Math.PI * 2); c.fill();
        c.fillRect(-8, 2, 6, 4);
        c.fillStyle = shade(color, -0.5);
        c.beginPath(); c.arc(-7, -1.5, 1.4, 0, Math.PI * 2); c.arc(-3, -1.5, 1.4, 0, Math.PI * 2); c.fill();
        c.fillRect(-6.5, 3, 1, 3); c.fillRect(-4, 3, 1, 3);
        break;
      case 'neon':
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(-13, -9, 26, 18);
        c.strokeStyle = color; c.lineWidth = 1.6;
        if (hiQ) { c.shadowColor = color; c.shadowBlur = 8; }
        rr(c, -11.5, -7.5, 23, 15, 3); c.stroke();
        c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.stroke();
        c.shadowBlur = 0;
        break;
      case 'gold': {
        const g = c.createLinearGradient(-13, -9, 13, 9);
        g.addColorStop(0, '#fff3b0'); g.addColorStop(0.35, '#e0b43a'); g.addColorStop(0.65, '#a87a10'); g.addColorStop(1, '#f5d76e');
        c.fillStyle = g;
        c.fillRect(-13, -9, 26, 18);
        c.fillStyle = color;
        c.fillRect(-13, -1.5, 26, 3);
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(-13 + ((time * 30) % 40) - 8, -9, 4, 18);
        break;
      }
      case 'rainbow':
        for (let i = 0; i < 6; i++) { c.fillStyle = hslHex((time * 90 + i * 60) % 360, 0.85, 0.58); c.fillRect(-13 + i * 4.4, -9, 4.6, 18); }
        break;
    }
  }

  // 特殊武器砲管樣式
  function barrelStyle(t) {
    const f = t.flags;
    if (f & 32) return { c: '#ff6ec7', w: 6, len: 22 };
    if (f & 2048) return { c: '#9dff5c', w: 8, len: 18, pod: true };
    if (f & 4096) return { c: '#ffcf6e', w: 9, len: 17, wide: true };
    if (f & 8192) return { c: '#ff7a2e', w: 7, len: 19, nozzle: true };
    if (f & 8) return { c: '#ffb142', w: 6, len: 20 };
    if (f & 16384) return { c: '#3dfcff', w: 6, len: 20 };
    return { c: null, w: 6, len: 20 };
  }

  function drawTank(c, t, alpha) {
    const sc = (t.r || C.TANK_R) / C.TANK_R;
    const S_ = SHAPES[t.cls] || SHAPES.medium;
    const [hx, hy, hw, hh] = S_.hull, [tx0, ty0, tw, th] = S_.top;
    let color = t.color;
    if (t.skin === 'rainbow' && !t.teamColor) color = hslHex((time * 90) % 360, 0.8, 0.55);
    c.save();
    c.globalAlpha = alpha;
    c.translate(t.x, t.y);
    if (sc !== 1) c.scale(sc, sc);
    c.fillStyle = theme.shadow;
    c.beginPath(); c.ellipse(3, 5, 19, 17, 0, 0, Math.PI * 2); c.fill();
    if (t.boss) {
      c.fillStyle = `rgba(155,93,229,${0.25 + Math.sin(time * 4) * 0.1})`;
      c.beginPath(); c.arc(0, 0, 27, 0, Math.PI * 2); c.fill();
    }
    c.rotate(t.ha);
    // 履帶：比車身寬一點，長度比車身多 6px
    const tk = S_.trk, outer = -hy + tk - 4, tl = hw + 6, tx = -tl / 2;
    c.fillStyle = '#17191c';
    c.fillRect(tx, -outer, tl, tk);
    c.fillRect(tx, outer - tk, tl, tk);
    c.fillStyle = '#3d424a';
    const off = ((t.dist || 0) % 6 + 6) % 6;
    for (let i = tx + off; i < -tx - 1; i += 6) { c.fillRect(i, -outer, 2, tk); c.fillRect(i, outer - tk, 2, tk); }
    if (S_.box) { c.fillStyle = '#25282c'; c.fillRect(hx - 4, -7, 4, 14); } // 自走砲車尾的駐鋤
    c.fillStyle = shade(color, -0.45);
    rr(c, hx, hy, hw, hh, 4); c.fill();
    if (S_.skirt) {
      // 重坦：履帶外側的裙甲
      c.fillStyle = shade(color, -0.55);
      rr(c, -tl / 2 + 3, -outer - 0.5, tl - 6, 5, 1.5); c.fill();
      rr(c, -tl / 2 + 3, outer - 4.5, tl - 6, 5, 1.5); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = -12; i <= 12; i += 8) { c.fillRect(i, -outer + 1.5, 1.6, 1.6); c.fillRect(i, outer - 3, 1.6, 1.6); }
    }
    c.fillStyle = color;
    rr(c, tx0, ty0, tw, th, 3); c.fill();
    if (t.skin && t.skin !== 'classic') {
      c.save();
      rr(c, tx0, ty0, tw, th, 3); c.clip();
      if (tw !== 26 || th !== 18) c.scale(tw / 26, th / 18);
      paintSkin(c, t.teamColor && (t.skin === 'gold' || t.skin === 'rainbow') ? 'stripe' : t.skin, color);
      c.restore();
    }
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(tx0, ty0, tw, 3.5);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(tx0 + tw - 3, ty0 + 2, 2, th - 4);
    if (S_.antenna) {
      // 輕坦：車尾一根會晃的天線
      const sway = Math.sin(time * 7 + (t.dist || 0) * 0.08) * 1.6;
      c.strokeStyle = 'rgba(15,15,15,0.85)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(tx0 + 3, ty0 + 3); c.quadraticCurveTo(tx0 - 4, ty0 - 1 + sway * 0.5, tx0 - 9, ty0 - 3 + sway); c.stroke();
      c.fillStyle = '#ff5252';
      c.beginPath(); c.arc(tx0 - 9, ty0 - 3 + sway, 1.3, 0, Math.PI * 2); c.fill();
    }
    // 扛旗：車尾插一支旗
    if (t.carry !== undefined && t.carry >= 0) {
      c.save(); c.rotate(-t.ha); drawFlagShape(c, -10, -8, TEAM_COLORS[t.carry], 0.8); c.restore();
    }
    c.rotate(t.ta - t.ha);
    const rc = t.recoil || 0;
    const bs = barrelStyle(t);
    const bc = bs.c || shade(color, -0.25);
    const bw = S_.bw, bl = S_.bl, x0 = S_.box ? 5 : 4, xe = x0 + 1 + bl - rc;
    c.fillStyle = '#1e2124';
    c.fillRect(x0 - rc, -bw / 2 - 1.5, bl + 2, bw + 3);
    c.fillStyle = bc;
    c.fillRect(x0 + 1 - rc, -bw / 2, bl, bw);
    c.fillStyle = '#1e2124';
    if (bs.wide) { c.beginPath(); c.moveTo(xe - 3, -6); c.lineTo(xe + 4, -8); c.lineTo(xe + 4, 8); c.lineTo(xe - 3, 6); c.closePath(); c.fill(); }
    else if (bs.nozzle) { c.fillRect(xe - 4, -5, 6, 10); c.fillStyle = '#ffb35c'; c.fillRect(xe + 1, -2.5, 2, 5); }
    else if (S_.brake) c.fillRect(xe - 3, -bw / 2 - 2.5, 5, bw + 5);
    else if (S_.box) c.fillRect(xe - 3, -bw / 2 - 1.5, 4, bw + 3);
    else c.fillRect(xe - 2, -bw / 2 - 2, 5, bw + 4);
    if (bs.pod) { c.fillStyle = '#d8ffd0'; c.beginPath(); c.arc(16 - rc, -6, 2.6, 0, Math.PI * 2); c.arc(16 - rc, 6, 2.6, 0, Math.PI * 2); c.fill(); }
    if (t.flags & 16) {
      const l2 = Math.max(12, bl * 0.75);
      c.fillStyle = '#1e2124';
      c.save(); c.rotate(-0.35); c.fillRect(6, -2, l2, 4); c.restore();
      c.save(); c.rotate(0.35); c.fillRect(6, -2, l2, 4); c.restore();
    }
    const capC = t.skin === 'gold' && !t.teamColor ? '#e8c14a' : shade(color, 0.12);
    if (S_.box) {
      // 自走砲：方方正正的大砲塔
      c.fillStyle = shade(color, -0.35);
      rr(c, -12, -9, 19, 18, 2.5); c.fill();
      c.fillStyle = capC;
      rr(c, -10.5, -7.5, 16, 15, 2); c.fill();
      c.fillStyle = shade(color, -0.2);
      c.beginPath(); c.arc(-5, 2.5, 2.6, 0, Math.PI * 2); c.fill();
      c.fillRect(-9, -6, 8, 2);
    } else if (S_.wedge) {
      // 驅逐戰車：低矮的楔形砲塔
      c.fillStyle = shade(color, -0.35);
      c.beginPath(); c.moveTo(-10, -8); c.lineTo(7, -5.5); c.lineTo(7, 5.5); c.lineTo(-10, 8); c.closePath(); c.fill();
      c.fillStyle = capC;
      c.beginPath(); c.moveTo(-8.5, -6.3); c.lineTo(5.5, -4.2); c.lineTo(5.5, 4.2); c.lineTo(-8.5, 6.3); c.closePath(); c.fill();
      c.fillStyle = shade(color, -0.2);
      c.beginPath(); c.arc(-4, 0, 2.4, 0, Math.PI * 2); c.fill();
    } else {
      const R = S_.tur;
      c.fillStyle = shade(color, -0.35);
      c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
      c.fillStyle = capC;
      c.beginPath(); c.arc(0, 0, R - 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = shade(color, -0.2);
      c.beginPath(); c.arc(-R * 0.2, 0, R * 0.32, 0, Math.PI * 2); c.fill();
    }
    if (t.boss) {
      c.rotate(-t.ta);
      c.fillStyle = '#ffd84d';
      c.beginPath(); c.moveTo(-8, -3); c.lineTo(-8, -9); c.lineTo(-4, -5); c.lineTo(0, -11); c.lineTo(4, -5); c.lineTo(8, -9); c.lineTo(8, -3); c.closePath(); c.fill();
    }
    c.restore();

    if (t.flags & 2) {
      c.save();
      c.globalAlpha = alpha * (0.55 + Math.sin(time * 8) * 0.15);
      c.strokeStyle = '#7fe3ff';
      c.lineWidth = 2.5;
      if (hiQ) { c.shadowColor = '#7fe3ff'; c.shadowBlur = 12; }
      c.beginPath(); c.arc(t.x, t.y, 25 * sc, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(127,227,255,0.08)';
      c.fill();
      c.restore();
    }
  }

  function drawFlagShape(c, x, y, color, s) {
    s = s || 1;
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 12); c.lineTo(0, -20); c.stroke();
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -20);
    for (let i = 0; i <= 6; i++) { const u = i / 6; c.lineTo(u * 20, -20 + Math.sin(time * 7 + u * 3) * 2.2 * u); }
    for (let i = 6; i >= 0; i--) { const u = i / 6; c.lineTo(u * 20, -8 + Math.sin(time * 7 + u * 3) * 2.2 * u); }
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath(); c.arc(9, -14, 2.6, 0, Math.PI * 2); c.fill();
    c.restore();
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
      case 'homing':
        c.moveTo(-7 * s, 5 * s); c.lineTo(4 * s, -6 * s); c.stroke();
        c.beginPath(); c.moveTo(7 * s, -9 * s); c.lineTo(1 * s, -7 * s); c.lineTo(5 * s, -3 * s); c.closePath(); c.fill();
        c.beginPath(); c.arc(-1 * s, 2 * s, 7 * s, -0.2, 1.8); c.stroke(); return;
      case 'shotgun': for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) { c.moveTo(-7 * s, 0); c.lineTo(-7 * s + Math.cos(a) * 15 * s, Math.sin(a) * 15 * s); } c.stroke(); return;
      case 'flame': c.moveTo(0, -9 * s); c.quadraticCurveTo(8 * s, 0, 4 * s, 8 * s); c.quadraticCurveTo(0, 4 * s, -4 * s, 8 * s); c.quadraticCurveTo(-8 * s, 0, 0, -9 * s); c.fill(); return;
      case 'cloak': c.arc(0, 0, 7 * s, 0, Math.PI * 2); c.setLineDash([3 * s, 3 * s]); c.stroke(); c.setLineDash([]); c.beginPath(); c.arc(-2.5 * s, -1 * s, 1.5 * s, 0, Math.PI * 2); c.arc(2.5 * s, -1 * s, 1.5 * s, 0, Math.PI * 2); c.fill(); return;
      case 'bounce': c.moveTo(-8 * s, -6 * s); c.lineTo(-2 * s, 6 * s); c.lineTo(3 * s, -4 * s); c.lineTo(8 * s, 5 * s); c.stroke(); return;
      case 'supply':
        // 補給包：十字 + 一排砲彈
        c.fillRect(-1.8 * s, -8 * s, 3.6 * s, 9 * s); c.fillRect(-6 * s, -5.3 * s, 12 * s, 3.6 * s);
        for (const x of [-6, -1.5, 3]) { c.fillRect(x * s, 3 * s, 3 * s, 5 * s); }
        return;
    }
  }

  // 空投箱：木箱 + 黃色閃燈，比一般道具大
  function drawCrate(c, x, y, s, beacon) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.fillStyle = '#5a3d1c';
    rr(c, -14, -14, 28, 28, 3); c.fill();
    c.fillStyle = '#9c6b34';
    rr(c, -12, -12, 24, 24, 2); c.fill();
    c.strokeStyle = '#5a3d1c'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-11, -11); c.lineTo(11, 11); c.moveTo(11, -11); c.lineTo(-11, 11); c.stroke();
    c.fillStyle = '#ffb300';
    c.fillRect(-14, -2.5, 28, 5);
    c.fillStyle = '#1b1b1b';
    c.font = `900 9px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('✈', 0, 0.5);
    if (beacon) {
      const on = Math.sin(time * 9) > 0;
      c.fillStyle = on ? '#fff3a0' : '#ff9f1a';
      c.beginPath(); c.arc(0, -14, 3.4, 0, Math.PI * 2); c.fill();
      if (on && hiQ) { c.fillStyle = 'rgba(255,220,80,0.35)'; c.beginPath(); c.arc(0, -14, 9, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  function drawPowerup(c, u) {
    const col = PU_COLOR[u.k] || '#fff';
    if (u.k === 'crate') {
      // 地上的空投：光柱 + 木箱
      const k = 0.5 + Math.sin(time * 4 + u.id) * 0.2;
      const gr = c.createRadialGradient(u.x, u.y, 4, u.x, u.y, 40);
      gr.addColorStop(0, `rgba(255,179,0,${0.45 * k})`); gr.addColorStop(1, 'rgba(255,179,0,0)');
      c.fillStyle = gr;
      c.beginPath(); c.arc(u.x, u.y, 40, 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(255,179,0,${0.5 * k})`; c.lineWidth = 2;
      c.beginPath(); c.arc(u.x, u.y, 24 + Math.sin(time * 5) * 3, 0, Math.PI * 2); c.stroke();
      drawCrate(c, u.x, u.y, 0.95, true);
      return;
    }
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
    const ux = b.vx / sp, uy = b.vy / sp;
    if (b.kind === 2) {
      // 追蹤飛彈
      if (Math.random() < (hiQ ? 0.9 : 0.4)) P({ x: b.x - ux * 12, y: b.y - uy * 12, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.6, r: 3, r1: 9, c: 'rgba(190,190,190,0.35)', drag: 1.5 });
      c.save();
      c.translate(b.x, b.y);
      c.rotate(Math.atan2(uy, ux));
      c.fillStyle = 'rgba(255,190,80,0.9)';
      c.beginPath(); c.moveTo(-9, -2.5); c.lineTo(-17 - Math.random() * 5, 0); c.lineTo(-9, 2.5); c.fill();
      c.fillStyle = color;
      c.beginPath(); c.moveTo(-9, -5); c.lineTo(-4, -2); c.lineTo(-4, 2); c.lineTo(-9, 5); c.fill();
      c.fillStyle = '#e8edf3';
      rr(c, -9, -2.6, 15, 5.2, 2.5); c.fill();
      c.fillStyle = '#ff5252';
      c.beginPath(); c.moveTo(6, -2.6); c.lineTo(10, 0); c.lineTo(6, 2.6); c.fill();
      c.restore();
      return;
    }
    if (b.kind === 3) {
      c.strokeStyle = 'rgba(255,215,120,0.55)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(b.x - ux * 9, b.y - uy * 9); c.lineTo(b.x, b.y); c.stroke();
      c.fillStyle = '#fff2c8';
      c.beginPath(); c.arc(b.x, b.y, 2, 0, Math.PI * 2); c.fill();
      return;
    }
    // [尾巴長度, 尾巴粗細, 光暈半徑, 彈芯半徑]：1 連射、5 驅逐戰車穿甲彈（細長）、6 重坦大砲彈
    const sz = b.kind === 1 ? [10, 3, 5, 2.4] : b.kind === 5 ? [32, 3.2, 6, 2.8] : b.kind === 6 ? [18, 6, 9.5, 4.4] : [16, 4.5, 7.5, 3.4];
    const tx = b.x - ux * sz[0], ty = b.y - uy * sz[0];
    if (hiQ) {
      const gr = c.createLinearGradient(tx, ty, b.x, b.y);
      gr.addColorStop(0, rgba(color, 0));
      gr.addColorStop(1, rgba(color, 0.8));
      c.strokeStyle = gr;
    } else c.strokeStyle = rgba(color, 0.55);
    c.lineWidth = sz[1];
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(b.x, b.y); c.stroke();
    if (b.kind === 5) {
      c.strokeStyle = 'rgba(230,251,255,0.85)'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(b.x - ux * 20, b.y - uy * 20); c.lineTo(b.x, b.y); c.stroke();
    }
    c.fillStyle = rgba(color, 0.35);
    c.beginPath(); c.arc(b.x, b.y, sz[2], 0, Math.PI * 2); c.fill();
    if (theme.light) { c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(b.x, b.y, sz[3] * 1.35, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = b.bounces > 0 ? '#ffe2b0' : b.kind === 5 ? '#e6fbff' : '#ffffff';
    c.beginPath(); c.arc(b.x, b.y, sz[3], 0, Math.PI * 2); c.fill();
    if (b.maxB > 1) {
      c.strokeStyle = `rgba(61,252,255,${0.5 + Math.sin(time * 20) * 0.3})`; c.lineWidth = 1.4;
      c.beginPath(); c.arc(b.x, b.y, 7.5, 0, Math.PI * 2); c.stroke();
    } else if (b.bounces > 0) {
      c.strokeStyle = 'rgba(255,90,60,0.8)'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(b.x, b.y, 6, 0, Math.PI * 2); c.stroke();
    }
  }

  function drawLabel(c, t, isMe, teamColor) {
    const sc = (t.r || C.TANK_R) / C.TANK_R;
    const y = t.y - 22 * sc - 8 * ls;
    c.font = `700 ${12 * ls}px ${FONT}`;
    c.textAlign = 'center';
    c.lineWidth = 3 * ls;
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.strokeText(t.name, t.x, y);
    c.fillStyle = isMe ? '#ffe28a' : t.boss ? '#e0b3ff' : teamColor || '#ffffff';
    c.fillText(t.name, t.x, y);
    const w = 34 * Math.min(ls, 1.5) * (t.boss ? 1.6 : 1), bh = 4 * ls, hp = Math.max(0, t.hp) / (t.mh || C.MAX_HP);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(t.x - w / 2 - 1, y + 4, w + 2, bh + 2);
    c.fillStyle = hp > 0.6 ? '#5cff6e' : hp > 0.3 ? '#ffd84d' : '#ff4d4d';
    c.fillRect(t.x - w / 2, y + 5, w * hp, bh);
    if (t.shield > 0) {
      c.fillStyle = '#7fe3ff';
      c.fillRect(t.x - w / 2, y + 5, w * Math.min(1, t.shield / 60), bh * 0.4);
    }
  }

  function drawBubble(c, x, y, text, a) {
    c.save();
    c.globalAlpha = a;
    c.translate(x, y);
    c.scale(ls, ls);
    c.translate(0, 24 - 24 / ls);
    c.font = `700 13px ${FONT}`;
    const w = c.measureText(text).width + 14;
    c.fillStyle = 'rgba(255,255,255,0.95)';
    rr(c, -w / 2, -58, w, 22, 8); c.fill();
    c.beginPath(); c.moveTo(-5, -37); c.lineTo(5, -37); c.lineTo(0, -31); c.fill();
    c.fillStyle = '#111';
    c.textAlign = 'center';
    c.fillText(text, 0, -42);
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
      const sc = (t.r || C.TANK_R) / C.TANK_R;
      const c = Math.cos(t.ha), s = Math.sin(t.ha);
      decalCtx.fillStyle = theme.light ? 'rgba(60,80,100,0.18)' : 'rgba(0,0,0,0.16)';
      for (const off of [-11.5 * sc, 11.5 * sc]) {
        decalCtx.save();
        decalCtx.translate(t.x - s * off, t.y + c * off);
        decalCtx.rotate(t.ha);
        decalCtx.fillRect(-3 * sc, -3.5 * sc, 6 * sc, 7 * sc);
        decalCtx.restore();
      }
    }
    return tr.dist;
  }

  // ---------------------------------------------------------------- 模式目標
  function drawObjectivesGround(c, o) {
    if (!o) return;
    if (o.mode === 'ctf' && o.homes) {
      o.homes.forEach((hm, t) => {
        const col = TEAM_COLORS[t];
        c.save();
        c.fillStyle = rgba(col, 0.14);
        c.beginPath(); c.arc(hm.x, hm.y, 30, 0, Math.PI * 2); c.fill();
        c.strokeStyle = rgba(col, 0.75); c.lineWidth = 3;
        c.setLineDash([8, 6]); c.lineDashOffset = -time * 20;
        c.beginPath(); c.arc(hm.x, hm.y, 30, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.restore();
      });
    } else if (o.mode === 'koth' && o.O && o.O.h) {
      const [hx, hy, hr, owner, cont, moveT] = o.O.h;
      const col = cont ? (Math.sin(time * 14) > 0 ? '#ffffff' : '#ff5252') : owner ? o.colorOf(owner) : '#ffd84d';
      c.save();
      const gr = c.createRadialGradient(hx, hy, hr * 0.2, hx, hy, hr);
      gr.addColorStop(0, rgba(col, 0.05)); gr.addColorStop(1, rgba(col, owner || cont ? 0.28 : 0.16));
      c.fillStyle = gr;
      c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba(col, 0.9); c.lineWidth = 4;
      c.setLineDash([16, 10]); c.lineDashOffset = -time * 30;
      c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = rgba(col, 0.35); c.lineWidth = 2;
      c.beginPath(); c.arc(hx, hy, hr * (0.55 + 0.1 * Math.sin(time * 3)), 0, Math.PI * 2); c.stroke();
      c.font = `900 ${13 * ls}px ${FONT}`; c.textAlign = 'center';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.7)';
      const label = moveT <= 10 ? `山頭 ${moveT} 秒後移動` : cont ? '爭奪中！' : '⛰️ 山頭';
      c.strokeText(label, hx, hy - hr - 6); c.fillStyle = col; c.fillText(label, hx, hy - hr - 6);
      c.restore();
    }
  }

  function drawFlags(c, o, tanks) {
    if (!o || o.mode !== 'ctf' || !o.O || !o.O.f) return;
    o.O.f.forEach((f, t) => {
      const [st, x, y, , timer] = f;
      if (st === 1) return; // 扛著的旗子畫在坦克上
      drawFlagShape(c, x - 2, y + 4, TEAM_COLORS[t], 1.1);
      if (st === 2) {
        c.strokeStyle = rgba(TEAM_COLORS[t], 0.9); c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * timer) / C.FLAG_RETURN); c.stroke();
      }
    });
  }

  function drawZone(c, o) {
    if (!o || o.mode !== 'br' || !o.O || !o.O.z) return;
    const [cx, cy, r, tx, ty, tr, , ph] = o.O.z;
    c.save();
    c.beginPath();
    c.rect(-400, -400, W + 800, H + 800);
    c.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
    c.fillStyle = 'rgba(105,30,190,0.3)';
    c.fill('evenodd');
    c.strokeStyle = 'rgba(214,140,255,0.95)'; c.lineWidth = 3.5;
    if (hiQ) { c.shadowColor = '#c77dff'; c.shadowBlur = 14; }
    c.beginPath(); c.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2); c.stroke();
    c.shadowBlur = 0;
    if (ph !== 2 && tr > 0) {
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2;
      c.setLineDash([10, 8]);
      c.beginPath(); c.arc(tx, ty, tr, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  // ---------------------------------------------------------------- 自走砲砲彈、空襲炸彈、空投、飛機
  // 拋物線最高點：飛越遠拋越高（只是畫面效果，模擬是直接算落地時間）
  const arcH = (d) => Math.max(50, d * 0.42);
  function shellPos(s, u) {
    const h = arcH(Math.hypot(s.tx - s.x0, s.ty - s.y0)) * 4 * u * (1 - u);
    return { gx: s.x0 + (s.tx - s.x0) * u, gy: s.y0 + (s.ty - s.y0) * u, h };
  }

  // 地上的落點警告圈（敵人的是紅色、自己和隊友的是橘色），畫在坦克底下
  function drawShellsGround(c, shells) {
    for (const s of shells) {
      const u = Core.clamp(s.t / s.T, 0, 1);
      const col = s.safe ? '255,177,66' : '255,60,50';
      c.save();
      c.fillStyle = `rgba(${col},${0.07 + u * 0.2})`;
      c.beginPath(); c.arc(s.tx, s.ty, s.r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(${col},${0.55 + u * 0.4})`;
      c.lineWidth = 2;
      c.setLineDash([7, 5]); c.lineDashOffset = -time * 24;
      c.beginPath(); c.arc(s.tx, s.ty, s.r, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      // 內圈越縮越小 = 快落地了
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(s.tx, s.ty, Math.max(2, s.r * (1 - u)), 0, Math.PI * 2); c.stroke();
      if (s.kind === 1) { c.beginPath(); c.moveTo(s.tx - 9, s.ty); c.lineTo(s.tx + 9, s.ty); c.moveTo(s.tx, s.ty - 9); c.lineTo(s.tx, s.ty + 9); c.stroke(); }
      // 影子
      let sx = s.tx, sy = s.ty, sr = 3 + 7 * u;
      if (s.kind === 0) { const p = shellPos(s, u); sx = p.gx; sy = p.gy; sr = 3.5 + 2.5 * u; }
      c.fillStyle = `rgba(0,0,0,${0.18 + 0.25 * u})`;
      c.beginPath(); c.ellipse(sx, sy, sr, sr * 0.7, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  // 天上的砲彈 / 炸彈（畫在草叢上面）
  function drawShellsAir(c, shells) {
    for (const s of shells) {
      const u = Core.clamp(s.t / s.T, 0, 1);
      c.save();
      if (s.kind === 0) {
        const p = shellPos(s, u), p2 = shellPos(s, Math.min(1, u + 0.03));
        const x = p.gx, y = p.gy - p.h;
        if (Math.random() < (hiQ ? 0.6 : 0.25)) P({ x, y, vx: rand(-10, 10), vy: rand(-10, 10), life: 0.5, r: 2.5, r1: 7, c: 'rgba(200,200,200,0.3)', drag: 2 });
        const k = 1 + p.h / 170; // 飛得越高看起來越大
        c.translate(x, y);
        c.rotate(Math.atan2(p2.gy - p2.h - y, p2.gx - x));
        c.scale(k, k);
        c.fillStyle = '#2b2b2b';
        rr(c, -6, -3, 12, 6, 3); c.fill();
        c.fillStyle = s.safe ? '#ffb142' : '#ff5a3d';
        c.fillRect(2, -3, 3, 6);
      } else {
        // 炸彈從天上掉下來
        const fall = (1 - u) * (1 - u) * 300;
        c.translate(s.tx, s.ty - fall);
        const k = 1.5 - u * 0.5;
        c.scale(k, k);
        c.fillStyle = '#26292e';
        c.beginPath(); c.ellipse(0, 0, 4.5, 8, 0, 0, Math.PI * 2); c.fill();
        c.fillRect(-5, -11, 10, 3);
        c.fillStyle = s.safe ? '#ffb142' : '#ff5a3d';
        c.fillRect(-4.5, -1, 9, 2);
      }
      c.restore();
    }
  }

  // 空投：地上的落點標記（坦克底下）
  function drawDropsGround(c, drops) {
    for (const d of drops) {
      const fall = Core.clamp(d.t / C.DROP_FALL, 0, 1);
      const k = 0.5 + Math.sin(time * 5) * 0.25;
      c.save();
      c.strokeStyle = `rgba(255,179,0,${0.5 + k * 0.4})`; c.lineWidth = 2.5;
      c.setLineDash([6, 6]); c.lineDashOffset = time * 20;
      c.beginPath(); c.arc(d.x, d.y, 26, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      if (d.t <= C.DROP_FALL) {
        const r = 6 + (1 - fall) * 10;
        c.fillStyle = `rgba(0,0,0,${0.15 + (1 - fall) * 0.3})`;
        c.beginPath(); c.ellipse(d.x, d.y, r, r * 0.7, 0, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
  }

  // 空投：掛著降落傘慢慢掉下來的箱子
  function drawDropsAir(c, drops) {
    for (const d of drops) {
      if (d.t > C.DROP_FALL) continue; // 飛機還沒飛到
      const fall = Core.clamp(d.t / C.DROP_FALL, 0, 1);
      const x = d.x + Math.sin(time * 2 + d.id) * 6 * fall, y = d.y - fall * 240;
      const s = 0.8 + fall * 0.35;
      c.save();
      c.translate(x, y);
      c.scale(s, s);
      c.strokeStyle = 'rgba(240,240,240,0.7)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-11, -10); c.lineTo(-22, -33); c.moveTo(11, -10); c.lineTo(22, -33); c.moveTo(0, -10); c.lineTo(0, -35); c.stroke();
      c.fillStyle = '#f2f2f2';
      c.beginPath(); c.moveTo(-27, -32); c.quadraticCurveTo(0, -64, 27, -32); c.quadraticCurveTo(13, -38, 0, -34); c.quadraticCurveTo(-13, -38, -27, -32); c.fill();
      c.fillStyle = '#ff6b3d';
      c.beginPath(); c.moveTo(-9, -36); c.quadraticCurveTo(0, -61, 9, -36); c.quadraticCurveTo(4.5, -37, 0, -34.5); c.quadraticCurveTo(-4.5, -37, -9, -36); c.fill();
      c.restore();
      drawCrate(c, x, y, 0.8 * s, false);
    }
  }

  function planeShape(c) {
    c.beginPath();
    c.moveTo(24, 0); c.quadraticCurveTo(22, -4, 14, -4.5); c.lineTo(-18, -3.5); c.lineTo(-22, 0); c.lineTo(-18, 3.5); c.lineTo(14, 4.5); c.quadraticCurveTo(22, 4, 24, 0);
    c.moveTo(8, -4); c.lineTo(-2, -27); c.lineTo(-8, -27); c.lineTo(-4, -4); c.closePath();
    c.moveTo(8, 4); c.lineTo(-4, 4); c.lineTo(-8, 27); c.lineTo(-2, 27); c.closePath();
    c.moveTo(-14, -3); c.lineTo(-20, -11); c.lineTo(-23, -11); c.lineTo(-20, -2); c.closePath();
    c.moveTo(-14, 3); c.lineTo(-20, 2); c.lineTo(-23, 11); c.lineTo(-20, 11); c.closePath();
    c.fill(); // 每一塊的繞行方向都一樣，半透明的影子重疊的地方才不會變深或破洞
  }

  // 飛機（運輸機丟空投、轟炸機空襲），影子投在地上
  function drawPlanes(c, dt) {
    for (let i = planes.length - 1; i >= 0; i--) {
      const p = planes[i];
      p.life -= dt;
      if (p.life <= 0) { planes.splice(i, 1); continue; }
      const u = 1 - p.life / p.T;
      const x = p.x0 + (p.x1 - p.x0) * u, y = p.y0 + (p.y1 - p.y0) * u;
      const a = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
      const s = p.k === 1 ? 1.55 : 1.25;
      c.save();
      c.translate(x + 34, y + 52); c.rotate(a); c.scale(s, s);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      planeShape(c);
      c.restore();
      c.save();
      c.translate(x, y); c.rotate(a); c.scale(s, s);
      c.fillStyle = p.k === 1 ? '#3b4048' : '#66745a';
      planeShape(c);
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(-16, -1.5, 34, 2);
      c.fillStyle = 'rgba(225,225,225,0.55)';
      for (const ey of [-13, 13]) { c.beginPath(); c.arc(5, ey, 3, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = Math.sin(time * 10) > 0 ? '#ff4d4d' : '#5cff6e';
      c.beginPath(); c.arc(-3, -26, 1.7, 0, Math.PI * 2); c.arc(-3, 26, 1.7, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  // 目標在畫面外時，在畫面邊緣畫箭頭指過去（螢幕座標）
  function drawPointers(c, list) {
    const m = 30, top = view.top + 24;
    for (const p of list) {
      const s = toScreen(p.x, p.y);
      if (s.x > m && s.x < view.cw - m && s.y > top && s.y < view.ch - m) continue;
      const cx = view.cw / 2, cy = (view.ch + view.top) / 2;
      const a = Math.atan2(s.y - cy, s.x - cx);
      const k = Math.min((view.cw / 2 - m) / Math.abs(Math.cos(a) || 1e-6), ((view.ch - view.top) / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
      c.save();
      c.translate(x * dpr, y * dpr);
      c.scale(dpr, dpr);
      c.globalAlpha = 0.6 + Math.sin(time * 6) * 0.25;
      c.fillStyle = p.c;
      c.save(); c.rotate(a);
      c.beginPath(); c.moveTo(18, 0); c.lineTo(6, -8); c.lineTo(6, 8); c.closePath(); c.fill();
      c.restore();
      c.globalAlpha = 1;
      c.font = `16px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(p.icon, 0, 0);
      c.restore();
    }
  }

  function setMiniH(h) { if (h !== lastMiniH) { lastMiniH = h; document.body.style.setProperty('--mm-h', h + 'px'); } }
  function drawMinimap(c, st, dt) {
    if (!view.follow || !map || !miniOn) { setMiniH(0); return; }
    if (miniDirty) buildMini();
    // 手機：放在左上角按鈕下面；電腦：放在 ⚙ 按鈕右邊。做得小一點、半透明，才不會擋到畫面
    const mw = Math.round(touchMode ? Math.min(112, view.cw * 0.13) : Math.min(150, view.cw * 0.12)), mh = Math.round((mw * H) / W);
    const x0 = touchMode ? 12 : 60, y0 = touchMode ? 56 : 10;
    setMiniH(touchMode ? mh + 12 : 0);
    // 有坦克開到小地圖底下就變得幾乎透明
    let under = false;
    for (const t of st.tanks) {
      const s = toScreen(t.x, t.y);
      if (s.x > x0 - 28 && s.x < x0 + mw + 28 && s.y > y0 - 28 && s.y < y0 + mh + 28) { under = true; break; }
    }
    miniFade += ((under ? 0.16 : 0.62) - miniFade) * Math.min(1, (dt || 0.016) * 8);
    c.save();
    c.scale(dpr, dpr);
    c.translate(x0, y0);
    c.globalAlpha = miniFade;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    rr(c, -3, -3, mw + 6, mh + 6, 6); c.fill();
    c.imageSmoothingEnabled = false;
    c.drawImage(miniCv, 0, 0, mw, mh);
    c.imageSmoothingEnabled = true;
    c.globalAlpha = Math.min(1, miniFade * 1.45);
    const k = mw / W;
    // 空投（掉下來中、已經落地的）
    c.fillStyle = '#ffb300';
    for (const d of st.drops || []) c.fillRect(d.x * k - 2.5, d.y * k - 2.5, 5, 5);
    for (const u of st.powerups) if (u.k === 'crate') c.fillRect(u.x * k - 2.5, u.y * k - 2.5, 5, 5);
    const o = st.obj;
    if (o && o.O) {
      if (o.mode === 'br' && o.O.z) {
        const [cx, cy, r, tx, ty, tr] = o.O.z;
        c.strokeStyle = '#d68cff'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx * k, cy * k, Math.max(0.1, r * k), 0, Math.PI * 2); c.stroke();
        if (tr > 0) { c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(tx * k, ty * k, tr * k, 0, Math.PI * 2); c.stroke(); }
      }
      if (o.mode === 'koth' && o.O.h) { const [hx, hy, hr] = o.O.h; c.strokeStyle = '#ffd84d'; c.lineWidth = 1.5; c.beginPath(); c.arc(hx * k, hy * k, hr * k, 0, Math.PI * 2); c.stroke(); }
      if (o.mode === 'ctf' && o.O.f) o.O.f.forEach((f, t) => { c.fillStyle = TEAM_COLORS[t]; c.fillRect(f[1] * k - 3, f[2] * k - 5, 6, 6); c.fillStyle = '#fff'; c.fillRect(f[1] * k - 3, f[2] * k - 5, 1, 9); });
    }
    for (const t of st.tanks) {
      c.fillStyle = t.me ? '#ffe28a' : t.ally ? (t.teamColor || '#5cff6e') : t.color;
      c.beginPath(); c.arc(t.x * k, t.y * k, t.me ? 3.4 : t.boss ? 3.6 : 2.4, 0, Math.PI * 2); c.fill();
      if (t.me) { c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke(); }
    }
    const tl = toWorld(0, view.top), br = toWorld(view.cw, view.ch);
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1;
    c.strokeRect(Math.max(0, tl.x) * k, Math.max(0, tl.y) * k, (Math.min(W, br.x) - Math.max(0, tl.x)) * k, (Math.min(H, br.y) - Math.max(0, tl.y)) * k);
    c.restore();
  }

  // ---------------------------------------------------------------- 一幀
  function frame(st, dt) {
    time += dt;
    if (!map) return;
    updateCamera(st.camTarget, dt);
    if (groundDirty) buildGround();
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = theme.bg;
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

    // 岩漿：整片慢慢一明一暗、冒泡泡、往上飄火星
    if (lavaTiles.length) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const [x, y, tx, ty] of lavaTiles) {
        c.fillStyle = `rgba(255,140,40,${0.07 + 0.07 * Math.sin(time * 1.6 + hash(tx, ty, 300) * 6.28)})`;
        c.fillRect(x, y, TILE, TILE);
        const ph = time * 0.8 + hash(tx, ty, 310), cyc = Math.floor(ph), u = ph - cyc;
        const bx = x + 8 + hash(tx, ty, 320 + cyc) * 24, by = y + 8 + hash(tx, ty, 340 + cyc) * 24;
        c.fillStyle = `rgba(255,224,138,${(1 - u) * 0.45})`;
        c.beginPath(); c.arc(bx, by, 1 + u * 5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      if (Math.random() < (hiQ ? 0.35 : 0.1)) {
        const [x, y] = lavaTiles[Math.floor(Math.random() * lavaTiles.length)];
        P({ x: x + rand(4, 36), y: y + rand(4, 36), vx: rand(-12, 12), vy: rand(-55, -25), life: rand(0.9, 1.6), r: rand(1.2, 2.2), r1: 0.4, c: Math.random() < 0.5 ? 'rgba(255,170,60,0.9)' : 'rgba(255,90,30,0.9)', add: true, drag: 0.6 });
      }
    }

    // 水波
    if (waterTiles.length) {
      c.strokeStyle = theme.light ? 'rgba(255,255,255,0.35)' : 'rgba(150,215,255,0.22)';
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
    }
    // 傳送門漩渦
    for (const p of portals) {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(time * 3);
      c.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        c.strokeStyle = rgba(p.c, 0.85 - i * 0.22);
        c.beginPath(); c.arc(0, 0, 16 - i * 4.5, i * 2, i * 2 + 4.2); c.stroke();
      }
      c.restore();
      if (hiQ) {
        const gr = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
        gr.addColorStop(0, rgba(p.c, 0.35)); gr.addColorStop(1, rgba(p.c, 0));
        c.fillStyle = gr;
        c.beginPath(); c.arc(p.x, p.y, 26, 0, Math.PI * 2); c.fill();
      }
    }
    // 加速帶箭頭
    if (pads.length) {
      c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
      const ph = (time * 2.2) % 1;
      for (const p of pads) {
        const [dx, dy] = p.d;
        const cx = p.x + 20, cy = p.y + 20;
        for (let i = 0; i < 2; i++) {
          const u = ((ph + i * 0.5) % 1) - 0.5;
          const ax = cx + dx * u * 26, ay = cy + dy * u * 26;
          c.strokeStyle = `rgba(255,205,60,${0.9 - Math.abs(u) * 1.2})`;
          c.beginPath();
          c.moveTo(ax - dx * 5 - dy * 7, ay - dy * 5 + dx * 7);
          c.lineTo(ax + dx * 3, ay + dy * 3);
          c.lineTo(ax - dx * 5 + dy * 7, ay - dy * 5 - dx * 7);
          c.stroke();
        }
      }
      c.lineCap = 'butt';
    }

    drawObjectivesGround(c, st.obj);
    if (st.shells) drawShellsGround(c, st.shells);
    if (st.drops) drawDropsGround(c, st.drops);
    for (const u of st.powerups) drawPowerup(c, u);
    for (const m of st.mines) drawMine(c, m, m.mine, m.team, m.color);
    drawFlags(c, st.obj, st.tanks);

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
      if (t.flags & 512) a *= t.me || t.ally ? 0.4 + Math.sin(time * 10) * 0.08 : 0.25;
      drawTank(c, t, a);
      const sc2 = (t.r || C.TANK_R) / C.TANK_R;
      if ((t.flags & 4) && Math.random() < 0.5) {
        const back = t.ha + Math.PI;
        P({ x: t.x + Math.cos(back) * 18 * sc2, y: t.y + Math.sin(back) * 18 * sc2, vx: Math.cos(back) * 60 + rand(-20, 20), vy: Math.sin(back) * 60 + rand(-20, 20), life: 0.25, r: 4, r1: 1, c: 'rgba(100,180,255,0.8)', add: true });
      }
      if (t.flags & 256) flameBurst(t.x + Math.cos(t.ta) * 24 * sc2, t.y + Math.sin(t.ta) * 24 * sc2, t.ta, hiQ ? 4 : 2);
      if (lavaTiles.length && Core.tileAt(map, Math.floor(t.x / TILE), Math.floor(t.y / TILE)) === T.LAVA && Math.random() < 0.6) {
        P({ x: t.x + rand(-14, 14) * sc2, y: t.y + rand(-12, 12) * sc2, vx: rand(-15, 15), vy: rand(-70, -30), life: rand(0.3, 0.55), r: rand(3, 5), r1: rand(8, 12), c: Math.random() < 0.5 ? 'rgba(255,150,40,0.7)' : 'rgba(255,90,20,0.7)', add: true, drag: 1.5 });
        if (Math.random() < 0.25) smoke(t.x, t.y, 1, 8, 0.8, 'rgba(40,30,25,0.45)');
      }
      if (t.hp < (t.mh || C.MAX_HP) * 0.35 && Math.random() < 0.25) smoke(t.x, t.y, 1, 9, 0.9, 'rgba(40,40,40,0.5)');
    }

    for (const b of st.bullets) drawBullet(c, b, b.color);

    c.globalAlpha = 0.94;
    c.drawImage(bushCv, 0, 0, W, H);
    c.globalAlpha = 1;
    for (const t of st.tanks) if ((t.flags & 64) && (t.me || t.ally)) drawTank(c, t, 0.4);
    if (st.shells) drawShellsAir(c, st.shells);
    if (st.drops) drawDropsAir(c, st.drops);

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
        for (const pts of b.segs) pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
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

    drawZone(c, st.obj);
    drawPlanes(c, dt);

    for (const t of st.tanks) if (!(t.flags & 512) || t.me || t.ally) drawLabel(c, t, t.me, t.teamColor);
    for (const b of st.bubbles) drawBubble(c, b.x, b.y, b.text, b.a);

    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      const k = f.life / f.max;
      f.y -= 32 * dt;
      c.globalAlpha = Math.min(1, k * 2);
      c.font = `900 ${f.size * ls * (1 + (1 - k) * 0.15)}px ${FONT}`;
      c.textAlign = 'center';
      c.lineWidth = 3.5; c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.c;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;

    // 瞄準線與準星
    if (st.aim) drawAim(c, st.aim, dt);

    c.setTransform(1, 0, 0, 1, 0, 0);
    if (st.dim) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(0, 0, cv.width, cv.height);
    } else {
      if (view.follow && st.pointers) drawPointers(c, st.pointers);
      drawMinimap(c, st, dt);
    }

    // 受傷紅框
    hurtFlash = Math.max(0, hurtFlash - dt * 1.6);
    const lowHp = st.lowHp ? 0.18 + Math.sin(time * 6) * 0.08 : 0;
    const lavaV = st.onLava ? 0.3 + Math.sin(time * 9) * 0.06 : 0;
    const vig = Math.max(hurtFlash, lowHp, lavaV, st.inZone ? 0.22 + Math.sin(time * 5) * 0.06 : 0);
    if (vig > 0.01) {
      const w = cv.width, h = cv.height;
      const gr = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      const col = lavaV && lavaV >= hurtFlash ? '255,90,0' : st.inZone && hurtFlash < 0.1 ? '150,40,220' : '220,0,0';
      gr.addColorStop(0, `rgba(${col},0)`);
      gr.addColorStop(1, `rgba(${col},${vig})`);
      c.fillStyle = gr;
      c.fillRect(0, 0, w, h);
    }
    killFlash = Math.max(0, killFlash - dt);
    if (killFlash > 0) {
      c.fillStyle = `rgba(255,220,120,${killFlash * 0.25})`;
      c.fillRect(0, 0, cv.width, cv.height);
    }
    goldFlash = Math.max(0, goldFlash - dt);
    if (goldFlash > 0) {
      c.fillStyle = `rgba(255,216,77,${goldFlash * 0.35})`;
      c.fillRect(0, 0, cv.width, cv.height);
    }
  }

  function drawAim(c, aim, dt) {
    hitMarker = Math.max(0, hitMarker - dt);
    const { x, y, from, ammo, ammoT, maxAmmo, rail, rapid } = aim;
    if (aim.arty && from && !aim.noLine) {
      // 自走砲：射程圈、拋物線、落點（三連發有三個落點）
      const A = aim.arty;
      c.save();
      c.lineWidth = 1.5 * ls;
      c.strokeStyle = 'rgba(255,200,120,0.2)';
      c.setLineDash([3 * ls, 9 * ls]);
      c.beginPath(); c.arc(from.x, from.y, C.ARTY_MAX, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(from.x, from.y, C.ARTY_MIN, 0, Math.PI * 2); c.stroke();
      const L = Math.hypot(A.x - from.x, A.y - from.y), top = arcH(L);
      c.strokeStyle = 'rgba(255,200,120,0.55)';
      c.setLineDash([4 * ls, 6 * ls]);
      c.beginPath();
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const px = from.x + (A.x - from.x) * u, py = from.y + (A.y - from.y) * u - top * 4 * u * (1 - u);
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.stroke();
      c.setLineDash([]);
      for (const o of A.tri ? [-1, 0, 1] : [0]) {
        const lx = A.x - Math.sin(A.ang) * o * 55, ly = A.y + Math.cos(A.ang) * o * 55;
        c.fillStyle = 'rgba(255,177,66,0.12)';
        c.strokeStyle = 'rgba(255,177,66,0.85)'; c.lineWidth = 2;
        c.beginPath(); c.arc(lx, ly, C.ARTY_RADIUS, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(lx - 7, ly); c.lineTo(lx + 7, ly); c.moveTo(lx, ly - 7); c.lineTo(lx, ly + 7); c.stroke();
      }
      c.restore();
    } else if (from && !aim.noLine) {
      const a = Math.atan2(y - from.y, x - from.x);
      const short = aim.range; // 霰彈、火焰的射程很短，只畫射程範圍
      const res = Core.castRay(map, from.x, from.y, a, short || 1400, short ? 0 : aim.bounces || 1, false, true);
      c.save();
      c.setLineDash([4 * ls, 7 * ls]);
      c.lineWidth = 1.5 * ls;
      const col = aim.color || (touchMode ? 'rgba(255,220,150,0.55)' : 'rgba(255,255,255,0.16)');
      c.strokeStyle = col;
      res.segs.forEach((pts, si) => {
        c.beginPath();
        const p0 = pts[0];
        if (si === 0) c.moveTo(p0[0] + Math.cos(a) * 26, p0[1] + Math.sin(a) * 26); else c.moveTo(p0[0], p0[1]);
        // 每段（傳送門會切段）畫到第一次反彈，反彈之後只畫一小截提示方向
        let lim = 2;
        for (let j = 1; j < pts.length && lim > 0; j++, lim--) {
          if (j === 1) { c.lineTo(pts[1][0], pts[1][1]); continue; }
          const pa = pts[j - 1], pb = pts[j];
          const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
          const k = Math.min(1, 70 / L);
          c.lineTo(pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k);
        }
        c.stroke();
      });
      if (!short && res.segs[0].length > 2) {
        c.setLineDash([]);
        c.fillStyle = 'rgba(255,200,120,0.45)';
        const p1 = res.segs[0][1];
        c.beginPath(); c.arc(p1[0], p1[1], 2.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      if (short) {
        c.save();
        c.strokeStyle = aim.color || 'rgba(255,200,120,0.35)'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(from.x, from.y, short, a - (aim.arc || 0.35), a + (aim.arc || 0.35)); c.stroke();
        c.restore();
      }
    }
    // 準星（外圈顯示彈藥）；手機版把彈藥圈畫在自己坦克周圍
    c.save();
    if (aim.ringOnly) {
      if (!from) { c.restore(); return; }
      c.translate(from.x, from.y);
      c.scale(1.7, 1.7);
    } else c.translate(x, y);
    if (!aim.ringOnly) {
      c.lineWidth = 2;
      c.strokeStyle = hitMarker > 0 ? '#ff4d4d' : theme.light ? '#16202a' : '#ffffff';
      c.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(dx * 4, dy * 4); c.lineTo(dx * 9, dy * 9); }
      c.stroke();
    }
    if (hitMarker > 0 && !aim.ringOnly) {
      c.lineWidth = 2.5;
      c.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(dx * 6, dy * 6); c.lineTo(dx * 13, dy * 13); }
      c.stroke();
    }
    if (aim.special) {
      // 特殊武器：外圈顯示剩幾發（火焰顯示燃料）
      const { k, n, max } = aim.special;
      const col = PU_COLOR[k] || '#fff';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(255,255,255,0.15)';
      c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = col;
      if (k === 'flame') { c.beginPath(); c.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, n / max)); c.stroke(); }
      else {
        const seg = (Math.PI * 2) / max, gap = 0.2;
        for (let i = 0; i < n; i++) { const a0 = -Math.PI / 2 + i * seg + gap / 2; c.beginPath(); c.arc(0, 0, 16, a0, a0 + seg - gap); c.stroke(); }
      }
    } else if (maxAmmo) {
      const n = maxAmmo, gap = 0.18, seg = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * seg + gap / 2, a1 = a0 + seg - gap;
        c.lineWidth = 3;
        c.strokeStyle = theme.light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)';
        c.beginPath(); c.arc(0, 0, 16, a0, a1); c.stroke();
        const fill = rapid ? 1 : i < ammo ? 1 : i === ammo ? ammoT : 0;
        if (fill > 0) {
          c.strokeStyle = rail ? '#ff6ec7' : rapid ? '#ffb142' : i < ammo ? '#ffd84d' : 'rgba(255,216,77,0.5)';
          c.beginPath(); c.arc(0, 0, 16, a0, a0 + (a1 - a0) * fill); c.stroke();
        }
      }
    }
    c.restore();
  }

  // 大廳的外觀 / 坦克種類預覽（驅逐戰車的砲管很長，縮小一點才放得下）
  function preview(canvas, color, skin, t, cls) {
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== 52 * d) { canvas.width = 52 * d; canvas.height = 52 * d; }
    const c = canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    const k = d * 1.15 * (cls === 'td' ? 0.8 : cls === 'heavy' ? 0.92 : 1);
    c.setTransform(k, 0, 0, k, (cls === 'td' ? 30 : 26) * d, (cls === 'td' ? 31 : 28) * d);
    const old = time;
    time = t || 0;
    drawTank(c, { x: 0, y: 0, ha: -Math.PI / 2, ta: -Math.PI / 2 - 0.5, color, skin, cls, flags: 0, r: C.TANK_R }, 1);
    time = old;
  }

  function setTouch(on) { touchMode = on; layout(); }
  function setMinimap(on) { miniOn = !!on; if (!on) setMiniH(0); }
  function setCamMode(m) { camMode = m; layout(); }
  function setSpectate(on) { if (spectate !== on) { spectate = on; layout(); } }
  function setQuality(hi) { if (hiQ !== hi) { hiQ = hi; resize(); } }

  return {
    init, resize, setMap, setTouch, setCamMode, setSpectate, setQuality, setMinimap, tileChanged, frame, toWorld, toScreen, preview, fx, view, PU_COLOR, TEAM_COLORS,
    get map() { return map; }, get following() { return view.follow; },
  };
})();
