'use strict';
// 產生純靜態網站到 dist/（給 GitHub Pages 用）：P2P 模式，不需要伺服器
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(OUT, 'shared'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.copyFileSync(require.resolve('peerjs/dist/peerjs.min.js'), path.join(OUT, 'vendor', 'peerjs.min.js'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(OUT, p)); } })(OUT);
console.log(`dist/ 產生完成（${files.length} 個檔案）：\n  ` + files.sort().join('\n  '));
