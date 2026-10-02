'use strict';
/*
 * HTTP 靜態檔案 + WebSocket 伺服器。
 *   npm start           → http://localhost:3000
 *   PORT=8080 npm start → 換 port
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');
const { WebSocketServer } = require('ws');
const { Room } = require('./game');
const { C } = require('../shared/core');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  let file;
  if (url === '/shared/core.js') file = path.join(ROOT, 'shared', 'core.js');
  else file = path.join(PUBLIC, path.normalize(url).replace(/^([/\\]*\.\.)+/, ''));
  if (!file.startsWith(PUBLIC) && !file.startsWith(path.join(ROOT, 'shared'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

wss.on('connection', (ws) => {
  let room = null, player = null;
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join' && !player) {
      const code = clean(msg.room, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TANK';
      room = rooms.get(code);
      if (!room) { room = new Room(code); rooms.set(code, room); }
      player = room.addPlayer({ name: clean(msg.name, 12) || '無名坦克', color: msg.color, ws });
      if (!player) { ws.send(JSON.stringify({ t: 'full' })); room = null; return; }
      room.emptySince = null;
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, room: code, lan: lanIPs(), port: PORT }));
      ws.send(room.mapMsg());
      ws.send(JSON.stringify(room.infoMsg()));
      return;
    }
    if (!player) return;
    switch (msg.t) {
      case 'i': room.input(player, msg.l); break;
      case 'cmd': room.command(player, msg); break;
      case 'taunt': room.taunt(player, msg.i); break;
      case 'p': ws.send(JSON.stringify({ t: 'P', c: msg.c })); break;
    }
  });
  ws.on('close', () => {
    if (room && player) room.removePlayer(player.id);
  });
  ws.on('error', () => {});
});

// 固定步長主迴圈
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  if (acc > 0.25) acc = 0.25;
  while (acc >= C.DT) {
    acc -= C.DT;
    for (const [code, room] of rooms) {
      if (room.humans() === 0) {
        if (room.emptySince === null) room.emptySince = now;
        else if (now - room.emptySince > 60000) { rooms.delete(code); continue; }
        continue;
      }
      try { room.tick(); } catch (e) { console.error(`[${code}] tick error:`, e); }
    }
  }
}, 4);

server.listen(PORT, () => {
  console.log('\n  🚀 坦克大亂鬥 伺服器已啟動！\n');
  console.log(`  本機：   http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  區網：   http://${ip}:${PORT}   ← 室友連這個`);
  console.log('\n  （按 Ctrl+C 結束）\n');
});
