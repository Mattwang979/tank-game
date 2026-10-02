/*
 * 連線層：
 *  - ws  ：連到 Node 伺服器（npm start 的區網模式）
 *  - p2p ：不用伺服器。第一個進房間的人的瀏覽器就是房主，直接跑遊戲模擬；
 *          其他人用 WebRTC（PeerJS）直接連到房主。網頁可以放在 GitHub Pages 這種靜態空間。
 * 兩種模式對 main.js 提供同樣的介面：send(obj)、handlers.onOpen / onMessage / onClose / onStatus
 */
const Net = (() => {
  const PREFIX = 'tankbrawl-v1-';
  const params = new URLSearchParams(location.search);

  function mode() { return params.get('net') || window.TB_NET || 'p2p'; }

  function ws(room, h) {
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    sock.onopen = () => h.onOpen();
    sock.onmessage = (e) => { try { h.onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    sock.onclose = () => h.onClose('伺服器斷線了');
    return { role: 'server', send(o) { if (sock.readyState === 1) sock.send(JSON.stringify(o)); } };
  }

  function peerOptions() {
    const ice = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
    const host = params.get('peerhost');
    if (host) {
      const [h, port] = host.split(':');
      return { host: h, port: Number(port || 9000), path: '/', secure: location.protocol === 'https:', debug: 0, config: ice };
    }
    return { debug: 0, config: ice };
  }

  function p2p(room, h) {
    if (typeof Peer === 'undefined') { h.onStatus('載入連線模組失敗，請重新整理'); return null; }
    const api = { role: null, send() {} };
    const opts = peerOptions();
    const id = PREFIX + room;
    let tries = 0;

    function asClient() {
      if (++tries > 4) return h.onStatus('連線失敗，請重新整理再試一次');
      h.onStatus('尋找房間中…');
      const peer = new Peer(opts);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        h.onStatus('連不上房主 😢 確認大家連同一個 Wi-Fi，或請房主重開房間');
        peer.destroy();
      }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(id, { serialization: 'raw', reliable: true });
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          api.role = 'client';
          api.send = (o) => { if (conn.open) conn.send(JSON.stringify(o)); };
          h.onOpen();
        });
        conn.on('data', (d) => { try { h.onMessage(JSON.parse(d)); } catch (err) { console.error(err); } });
        conn.on('close', () => { if (api.role) h.onClose('房主離開了，遊戲結束'); });
        conn.on('error', () => {});
      });
      peer.on('error', (err) => {
        if (settled) return;
        if (err.type === 'peer-unavailable') {
          // 還沒有人開這個房間 → 自己當房主
          settled = true;
          clearTimeout(timer);
          peer.destroy();
          asHost();
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          settled = true;
          clearTimeout(timer);
          h.onStatus('連不上配對伺服器，請檢查網路');
        }
      });
    }

    function asHost() {
      if (++tries > 4) return h.onStatus('建立房間失敗，請重新整理再試一次');
      h.onStatus('建立房間中…');
      const peer = new Peer(id, opts);
      peer.on('open', () => {
        if (api.role) return;
        api.role = 'host';
        const game = new TBGame.Room(room);
        startLoop(game);
        // 房主自己也是一個玩家：用假的 socket 直接對接
        const local = {
          readyState: 1, bufferedAmount: 0,
          send(s) { try { h.onMessage(JSON.parse(s)); } catch (err) { console.error(err); } },
        };
        const me = TBGame.createClient(local, () => game, () => ({ host: true }));
        api.send = (o) => me.message(o);
        api.peerCount = () => game.humans();
        peer.on('connection', (conn) => {
          const sock = {
            get readyState() { return conn.open ? 1 : 3; },
            get bufferedAmount() { return conn.dataChannel ? conn.dataChannel.bufferedAmount : 0; },
            send(s) { try { conn.send(s); } catch (e) {} },
          };
          const client = TBGame.createClient(sock, () => game, () => ({}));
          conn.on('data', (d) => client.message(d));
          conn.on('close', () => client.close());
          conn.on('error', () => client.close());
        });
        h.onOpen();
      });
      peer.on('disconnected', () => { if (api.role === 'host' && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1000); });
      peer.on('error', (err) => {
        if (api.role) return;
        if (err.type === 'unavailable-id') { peer.destroy(); asClient(); } // 同時有人開了同一間 → 改當玩家加入
        else h.onStatus('建立房間失敗：' + err.type);
      });
    }

    asClient();
    return api;
  }

  function startLoop(game) {
    const DT = Core.C.DT;
    let last = performance.now(), acc = 0;
    setInterval(() => {
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      if (acc > 0.25) acc = 0.25;
      while (acc >= DT) {
        acc -= DT;
        try { game.tick(); } catch (e) { console.error('tick error', e); }
      }
    }, 4);
  }

  return {
    mode,
    connect(room, handlers) { return mode() === 'ws' ? ws(room, handlers) : p2p(room, handlers); },
  };
})();
