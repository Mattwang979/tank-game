/*
 * 共用核心：常數、地圖格子、坦克移動與碰撞、砲彈反彈、射線。
 * 伺服器（權威模擬）與瀏覽器（本地預測 / 砲彈外插）都使用同一份程式碼，
 * 才能讓自己的坦克在高延遲下仍然跟手。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 40;
  // ICE 冰面（會滑）、PORTAL 傳送門（和 180° 對面的傳送門相連）、PAD_* 加速帶（箭頭方向）
  const T = { FLOOR: 0, STEEL: 1, BRICK: 2, WATER: 3, BUSH: 4, BARREL: 5, ICE: 6, PORTAL: 7, PAD_R: 8, PAD_L: 9, PAD_D: 10, PAD_U: 11 };
  const PAD_DIR = { 8: [1, 0], 9: [-1, 0], 10: [0, 1], 11: [0, -1] };

  const C = {
    TICK_RATE: 60,
    DT: 1 / 60,
    TANK_R: 15,
    TANK_SPEED: 170,
    ACCEL: 11,
    BOOST_MULT: 1.4,
    DASH_SPEED: 560,
    DASH_TIME: 0.15,
    DASH_CD: 2.2,
    MAX_HP: 100,

    ICE_ACCEL: 1.35,   // 冰面上的加速度（平常是 11，越小越滑）
    ICE_MAX: 1.15,     // 冰面上滑得比較快
    PAD_SPEED: 470,    // 加速帶把坦克彈到這個速度
    PAD_SLIDE: 0.22,   // 彈出去之後保留慣性的時間
    SLIDE_ACCEL: 2.6,

    BULLET_SPEED: 520,
    BULLET_LIFE: 2.6,
    BULLET_BOUNCES: 1,
    BULLET_DMG: 34,
    RAPID_DMG: 22,
    MAX_AMMO: 4,
    AMMO_REGEN: 0.6,
    FIRE_CD: 0.22,
    RAPID_CD: 0.11,

    RAIL_CD: 0.6,
    RAIL_DMG: 75,
    RAIL_BOUNCES: 2,
    RAIL_LEN: 1800,

    MISSILE_SPEED: 300,
    MISSILE_TURN: 3.4,
    MISSILE_LIFE: 3.6,
    MISSILE_RANGE: 560,
    MISSILE_RADIUS: 64,
    MISSILE_DMG: 62,

    PELLETS: 7,
    PELLET_SPREAD: 0.34,
    PELLET_SPEED: 620,
    PELLET_LIFE: 0.3,
    PELLET_DMG: 13,

    FLAME_RANGE: 155,
    FLAME_ARC: 0.36,
    FLAME_DPS: 80,
    FLAME_FUEL: 4.5,

    CLOAK_TIME: 9,
    BOUNCE_TIME: 12,
    BOUNCE_MAX: 3,

    MINE_ARM: 0.9,
    MINE_TRIGGER: 24,
    MINE_RADIUS: 95,
    MINE_DMG: 85,
    MINE_MAX_ACTIVE: 4,
    MINE_REGEN: 7,
    MINE_BASE: 3,
    MINE_CAP: 6,
    MINE_SEE: 80,

    BARREL_RADIUS: 105,
    BARREL_DMG: 70,
    BARREL_RESPAWN: 25,
    BRICK_HP: 3,

    RESPAWN: 3,
    PROTECT: 2,
    BUSH_SEE: 110,

    FLAG_R: 20,
    FLAG_RETURN: 15,
    HILL_R: 92,
    HILL_MOVE: 40,
  };

  // 輸入按鍵位元
  const K = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, MINE: 32, DASH: 64 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  const angDiff = (a, b) => wrapAngle(a - b);
  const lerpAngle = (a, b, t) => a + angDiff(b, a) * t;

  function tileAt(map, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return T.STEEL;
    return map.tiles[ty * map.w + tx];
  }
  const blocksTank = (t) => t === T.STEEL || t === T.BRICK || t === T.WATER || t === T.BARREL;
  const blocksBullet = (t) => t === T.STEEL || t === T.BRICK || t === T.BARREL;
  // 傳送門兩兩成對：和地圖中心點對稱（180° 旋轉）的那一格
  const portalPartner = (map, tx, ty) => [map.w - 1 - tx, map.h - 1 - ty];

  // 圓形坦克與方格牆面的碰撞，推出並消去撞牆方向的速度
  function resolveTank(map, t, r) {
    r = r || t.r || C.TANK_R;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor((t.x - r) / TILE), x1 = Math.floor((t.x + r) / TILE);
      const y0 = Math.floor((t.y - r) / TILE), y1 = Math.floor((t.y + r) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!blocksTank(tileAt(map, tx, ty))) continue;
          const bx = tx * TILE, by = ty * TILE;
          const cx = clamp(t.x, bx, bx + TILE), cy = clamp(t.y, by, by + TILE);
          const dx = t.x - cx, dy = t.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          let nx, ny, pen;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; pen = r - d;
          } else {
            const l = t.x - bx, rr = bx + TILE - t.x, u = t.y - by, dd = by + TILE - t.y;
            const m = Math.min(l, rr, u, dd);
            if (m === l) { nx = -1; ny = 0; pen = l + r; }
            else if (m === rr) { nx = 1; ny = 0; pen = rr + r; }
            else if (m === u) { nx = 0; ny = -1; pen = u + r; }
            else { nx = 0; ny = 1; pen = dd + r; }
          }
          t.x += nx * pen; t.y += ny * pen;
          const vn = t.vx * nx + t.vy * ny;
          if (vn < 0) { t.vx -= vn * nx; t.vy -= vn * ny; }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // 以一個輸入推進坦克一步（伺服器與客戶端預測共用，必須是決定性的）
  // 會用到的坦克欄位：x y vx vy ha dashT dashCd slideT portLock boost spd r
  function stepTank(t, k, dt, map) {
    if (t.dashCd > 0) t.dashCd = Math.max(0, t.dashCd - dt);
    if (t.slideT > 0) t.slideT = Math.max(0, t.slideT - dt);
    let mx = ((k & K.RIGHT) ? 1 : 0) - ((k & K.LEFT) ? 1 : 0);
    let my = ((k & K.DOWN) ? 1 : 0) - ((k & K.UP) ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len) { mx /= len; my /= len; }
    const ground = tileAt(map, Math.floor(t.x / TILE), Math.floor(t.y / TILE));

    if ((k & K.DASH) && t.dashCd <= 0) {
      let dx = mx, dy = my;
      if (!len) { dx = Math.cos(t.ha); dy = Math.sin(t.ha); }
      t.vx = dx * C.DASH_SPEED; t.vy = dy * C.DASH_SPEED;
      t.dashT = C.DASH_TIME; t.dashCd = C.DASH_CD;
      t.justDashed = true;
    }
    if (t.dashT > 0) {
      t.dashT = Math.max(0, t.dashT - dt);
    } else {
      const ice = ground === T.ICE;
      const sp = C.TANK_SPEED * (t.boost ? C.BOOST_MULT : 1) * (t.spd || 1) * (ice ? C.ICE_MAX : 1);
      const acc = ice ? C.ICE_ACCEL : t.slideT > 0 ? C.SLIDE_ACCEL : C.ACCEL;
      const f = Math.min(1, acc * dt);
      t.vx += (mx * sp - t.vx) * f;
      t.vy += (my * sp - t.vy) * f;
    }
    // 加速帶：把沿著箭頭方向的速度補到 PAD_SPEED，垂直方向還是可以控制
    const pd = PAD_DIR[ground];
    if (pd) {
      const along = t.vx * pd[0] + t.vy * pd[1];
      if (along < C.PAD_SPEED) { t.vx += pd[0] * (C.PAD_SPEED - along); t.vy += pd[1] * (C.PAD_SPEED - along); }
      if (!(t.slideT > 0)) t.justPadded = true;
      t.slideT = C.PAD_SLIDE;
    }
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const r = t.r || C.TANK_R;
    resolveTank(map, t, r);

    // 傳送門：車身中心進到傳送門的格子就瞬間移到對面的傳送門，速度方向不變
    const tx = Math.floor(t.x / TILE), ty = Math.floor(t.y / TILE);
    if (tileAt(map, tx, ty) === T.PORTAL) {
      const idx = ty * map.w + tx;
      if (t.portLock !== idx) {
        const [px, py] = portalPartner(map, tx, ty);
        const fx = t.x, fy = t.y;
        t.x = px * TILE + TILE / 2; t.y = py * TILE + TILE / 2;
        t.portLock = py * map.w + px;
        resolveTank(map, t, r);
        t.justPorted = [fx, fy, t.x, t.y];
      }
    } else t.portLock = -1;

    // 車身轉向移動方向（可倒車）
    const s2 = t.vx * t.vx + t.vy * t.vy;
    if (s2 > 400) {
      let target = Math.atan2(t.vy, t.vx);
      let d = angDiff(target, t.ha);
      if (Math.abs(d) > Math.PI / 2) { target += Math.PI; d = angDiff(target, t.ha); }
      const maxr = 10 * dt;
      t.ha = wrapAngle(t.ha + clamp(d, -maxr, maxr));
    }
  }

  // 依撞到的格子決定反彈軸
  function reflect(map, x, y, tx, ty, o, solid) {
    const ox = Math.floor(x / TILE), oy = Math.floor(y / TILE);
    const hx = tx !== ox && solid(tileAt(map, tx, oy));
    const hy = ty !== oy && solid(tileAt(map, ox, ty));
    if (hx && !hy) o.vx = -o.vx;
    else if (hy && !hx) o.vy = -o.vy;
    else if (hx && hy) { o.vx = -o.vx; o.vy = -o.vy; }
    else {
      if (tx !== ox) o.vx = -o.vx;
      if (ty !== oy) o.vy = -o.vy;
      if (tx === ox && ty === oy) { o.vx = -o.vx; o.vy = -o.vy; }
    }
  }

  // 推進砲彈；onTile(b, tx, ty, tileType, hitX, hitY) 回傳 true 代表反彈，false 代表消失
  // 穿過傳送門時 b.tp 會記錄 [入口x, 入口y, 出口x, 出口y]（碰撞判定要分兩段算）
  function stepBullet(map, b, dt, onTile) {
    const sp = Math.hypot(b.vx, b.vy);
    const n = Math.max(1, Math.ceil((sp * dt) / 5));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const nx = b.x + b.vx * h, ny = b.y + b.vy * h;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      const tt = tileAt(map, tx, ty);
      if (blocksBullet(tt)) {
        if (!onTile(b, tx, ty, tt, nx, ny)) return false;
        reflect(map, b.x, b.y, tx, ty, b, blocksBullet);
        continue;
      }
      b.x = nx; b.y = ny;
      if (tt === T.PORTAL) {
        const idx = ty * map.w + tx;
        if (b.pl !== idx) {
          const [px, py] = portalPartner(map, tx, ty);
          const ox = (px - tx) * TILE, oy = (py - ty) * TILE;
          b.tp = [b.x, b.y, b.x + ox, b.y + oy];
          b.x += ox; b.y += oy;
          b.pl = py * map.w + px;
        }
      } else b.pl = -1;
    }
    return true;
  }

  // 雷射 / 瞄準線：鋼牆反彈；pierce 時貫穿磚牆與油桶（回傳被貫穿的格子）
  // pierce=false 時遇到非鋼牆就停（給電腦玩家預測反彈射擊用）
  // portals=true 時會穿過傳送門，segs 是被傳送門切開的多段折線（pts 是第一段）
  function castRay(map, x, y, a, len, bounces, pierce, portals) {
    const o = { vx: Math.cos(a), vy: Math.sin(a) };
    let pts = [[x, y]];
    const segs = [pts];
    const hits = [];
    const seen = new Set();
    const step = 3;
    let traveled = 0, b = 0, pl = -1, jumps = 0;
    const done = (end) => ({ pts: segs[0], segs, hits, end });
    while (traveled < len) {
      const nx = x + o.vx * step, ny = y + o.vy * step;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      const tt = tileAt(map, tx, ty);
      if (tt === T.STEEL || (!pierce && blocksBullet(tt))) {
        if (tt !== T.STEEL || b >= bounces) { pts.push([x, y]); return done(tt); }
        reflect(map, x, y, tx, ty, o, (q) => q === T.STEEL);
        b++;
        pts.push([x, y]);
        continue;
      }
      if (tt === T.BRICK || tt === T.BARREL) {
        const i = ty * map.w + tx;
        if (!seen.has(i)) { seen.add(i); hits.push({ i, tx, ty, t: tt }); }
      }
      x = nx; y = ny; traveled += step;
      if (portals && tt === T.PORTAL) {
        const idx = ty * map.w + tx;
        if (idx !== pl && jumps < 4) {
          const [px, py] = portalPartner(map, tx, ty);
          pts.push([x, y]);
          x += (px - tx) * TILE; y += (py - ty) * TILE;
          pl = py * map.w + px;
          jumps++;
          pts = [[x, y]];
          segs.push(pts);
        }
      } else pl = -1;
    }
    pts.push([x, y]);
    return done(-1);
  }

  function lineClear(map, x0, y0, x1, y1, block) {
    block = block || blocksBullet;
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.hypot(dx, dy) / 6);
    for (let i = 1; i < n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      if (block(tileAt(map, Math.floor(x / TILE), Math.floor(y / TILE)))) return false;
    }
    return true;
  }

  function segPointDist(x0, y0, x1, y1, px, py) {
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    const cx = x0 + dx * t - px, cy = y0 + dy * t - py;
    return Math.sqrt(cx * cx + cy * cy);
  }

  function decodeTiles(str) {
    const a = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) - 48;
    return a;
  }
  const encodeTiles = (arr) => Array.from(arr, (v) => String.fromCharCode(48 + v)).join('');

  return {
    TILE, T, C, K, PAD_DIR,
    clamp, wrapAngle, angDiff, lerpAngle,
    tileAt, blocksTank, blocksBullet, portalPartner,
    resolveTank, stepTank, reflect, stepBullet, castRay, lineClear, segPointDist,
    decodeTiles, encodeTiles,
  };
});
