'use strict';
/*
 * 區網伺服器模式：HTTP 靜態檔案 + WebSocket。
 *   npm start           → http://localhost:3000
 *   PORT=8080 npm start → 換 port
 * （不想架伺服器的話，GitHub Pages 上的版本是 P2P 模式，開房的人的瀏覽器就是伺服器）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Room, createClient } = require('../shared/game');
const { C } = require('../shared/core');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PEERJS = path.join(ROOT, 'node_modules', 'peerjs', 'dist', 'peerjs.min.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    return res.end("window.TB_NET = 'ws';\n");
  }
  const rel = path.normalize(url).replace(/^([/\\]*\.\.)+/, '');
  let file;
  if (rel.replace(/\\/g, '/').startsWith('/shared/')) file = path.join(ROOT, rel);
  else if (rel.replace(/\\/g, '/') === '/vendor/peerjs.min.js') file = PEERJS;
  else file = path.join(PUBLIC, rel);
  if (file !== PEERJS && !file.startsWith(PUBLIC + path.sep) && !file.startsWith(SHARED + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
const getRoom = (code) => {
  let room = rooms.get(code);
  if (!room) { room = new Room(code); rooms.set(code, room); }
  return room;
};
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const client = createClient(ws, getRoom, () => ({ lan: lanIPs(), port: PORT }));
  ws.on('message', (data) => client.message(String(data)));
  ws.on('close', () => client.close());
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
