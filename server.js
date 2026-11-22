/* Clubhouse multiplayer server — zero dependencies (Node 18+).
   One process serves the game (index.html) AND the WebSocket relay at /ws, so a single deploy gives you a playable URL.
     node server.js            (PORT env var, default 8080)
   Rooms: a public lobby (auto-fills 12 per room) and private rooms with a 4-letter code. The server only relays state
   (positions, chat, scores) — each player's golf physics run on their own device.
   v4: the server is also the room's clock and knows which game build it is serving. Every 'hello' and 'pong' carries the
   server time (so the sportsbook card — races, sumo, Final Drive — runs in lockstep on every phone, whatever its own clock
   says) and the build number in index.html (so a player on an old cached copy is told to reload). GET /version returns both.
   v5: shared tables (poker, darts) send their whole table as a small object; the relay now passes those through too — every string is
   stripped of markup characters and clipped, numbers are clamped, depth, key count and total size are capped. */
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 8080, MAX_ROOM = 12, MAX_CONN = 600, MAX_PER_IP = +process.env.MAX_PER_IP || 10, GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const INDEX = path.join(__dirname, 'index.html'), PROTO = 5;
let BUILD = { v: '?', mtime: 0 };                         // the game build in index.html (const BUILD = 'V…'), re-read whenever the file changes
function build() { try { const st = fs.statSync(INDEX); if (st.mtimeMs !== BUILD.mtime) { const m = fs.readFileSync(INDEX, 'utf8').match(/const BUILD = '([^']+)'/); BUILD = { v: m ? m[1] : '?', mtime: st.mtimeMs }; } } catch (_) { /* no index.html */ } return BUILD.v; }

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => { if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('index.html not found next to server.js'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf); });
  } else if (url === '/version') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ build: build(), ver: PROTO, now: Date.now() })); }
  else if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok ' + build() + ' · ' + rooms.size + ' rooms ' + conns + ' players'); }
  else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); }
});

/* ---------- minimal RFC 6455 WebSocket ---------- */
let conns = 0; const perIp = new Map();
function frame(str) {
  const body = Buffer.from(str, 'utf8'), n = body.length; let head;
  if (n < 126) head = Buffer.from([0x81, n]); else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); } else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, body]);
}
server.on('upgrade', (req, socket) => {
  const url = (req.url || '').split('?')[0], key = req.headers['sec-websocket-key'], ip = (req.headers['x-forwarded-for'] || socket.remoteAddress || '?').toString().split(',')[0].trim();
  if (url !== '/ws' || !key || conns >= MAX_CONN || (perIp.get(ip) || 0) >= MAX_PER_IP) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); conns++; perIp.set(ip, (perIp.get(ip) || 0) + 1);
  const c = { socket, ip, buf: Buffer.alloc(0), frag: null, alive: true, seen: Date.now(), closed: false, P: null, send(obj) { if (!c.closed && socket.writable) socket.write(frame(JSON.stringify(obj))); } };
  socket.on('data', d => { c.buf = Buffer.concat([c.buf, d]); if (c.buf.length > 40000) return kill(c); try { parse(c); } catch (_) { kill(c); } });
  const end = () => { if (c.closed) return; c.closed = true; conns--; perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); leave(c); };
  socket.on('close', end); socket.on('error', end); c.end = end;
});
function kill(c) { try { c.socket.destroy(); } catch (_) { /* gone */ } c.end && c.end(); }
function parse(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80); let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (!masked || len > 16384) return kill(c);
    if (b.length < off + 4 + len) return;
    const mask = b.slice(off, off + 4), data = Buffer.from(b.slice(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = b.slice(off + 4 + len);
    if (op === 8) { try { c.socket.end(Buffer.from([0x88, 0x00])); } catch (_) { /* gone */ } return kill(c); }
    if (op === 9) { c.socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
    if (op === 10) { c.alive = true; continue; }
    if (op === 1 || op === 0) {
      if (op === 1) c.frag = []; if (!c.frag) continue; c.frag.push(data); if (c.frag.reduce((a, x) => a + x.length, 0) > 16384) return kill(c);
      if (fin) { const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = null; let m; try { m = JSON.parse(txt); } catch (_) { continue; } if (m && typeof m === 'object') onMsg(c, m); }
    }
  }
}
setInterval(() => { for (const r of rooms.values()) for (const P of r.players.values()) { const c = P.c; if (!c.alive && Date.now() - c.seen > 70000) kill(c); else { c.alive = false; try { c.socket.write(Buffer.from([0x89, 0x00])); } catch (_) { /* gone */ } } } }, 25000).unref();

/* ---------- rooms ---------- */
const rooms = new Map(); let nextId = 1, pubN = 1;
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const num = (v, lim = 100000) => (typeof v === 'number' && isFinite(v)) ? Math.max(-lim, Math.min(lim, Math.round(v * 100) / 100)) : 0;
const cleanName = s => String(s || '').replace(/[^\w .!?'\-]/g, '').trim().slice(0, 14);
const cleanText = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 120);
const cleanEq = e => { const o = {}; if (e && typeof e === 'object') for (const k of ['hat', 'shirt', 'pants', 'shoes', 'suit', 'club', 'ball', 'neck', 'wrist', 'face', 'pet', 'trail', 'bag']) if (typeof e[k] === 'string' && /^[\w]{1,24}$/.test(e[k])) o[k] = e[k]; return o; };
const cleanVal = (v, dep) => { if (typeof v === 'number') return isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : 0; if (typeof v === 'boolean' || v === null) return v; if (typeof v === 'string') return v.replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').slice(0, 64);
  if (dep >= 4 || typeof v !== 'object') return null; if (Array.isArray(v)) return v.slice(0, 80).map(x => cleanVal(x, dep + 1)); const o = {}; let n = 0; for (const k of Object.keys(v)) { if (n++ >= 24) break; if (/^\w{1,12}$/.test(k)) o[k] = cleanVal(v[k], dep + 1); } return o; };
function pub(P) { return { id: P.id, name: P.name, eq: P.eq, s: P.s, rel: P.rel, holes: P.holes }; }
function cast(room, obj, except) { const msg = frame(JSON.stringify(obj)); for (const P of room.players.values()) if (P !== except && !P.c.closed && P.c.socket.writable) P.c.socket.write(msg); }
function board(room) { return [...room.players.values()].filter(P => P.holes > 0).map(P => ({ id: P.id, name: P.name, rel: P.rel, holes: P.holes })).sort((a, b) => a.rel - b.rel || b.holes - a.holes).slice(0, 12); }
function findPublic() { for (const r of rooms.values()) if (r.pub && r.players.size < MAX_ROOM) return r; const r = { code: 'PUB' + pubN++, pub: true, players: new Map() }; rooms.set(r.code, r); return r; }
function newCode() { for (let t = 0; t < 50; t++) { let s = ''; for (let i = 0; i < 4; i++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; if (!rooms.has(s)) return s; } return 'X' + Date.now().toString(36).slice(-3).toUpperCase(); }
function leave(c) {
  const P = c.P; if (!P) return; const r = P.room; c.P = null; r.players.delete(P.id);
  if (!r.players.size) rooms.delete(r.code); else { cast(r, { t: 'leave', id: P.id }); cast(r, { t: 'board', list: board(r) }); }
}
function onMsg(c, m) {
  const now = Date.now(); c.seen = now;
  if (m.t === 'join') {
    if (c.P) return;
    const want = String(m.room == null ? 'PUBLIC' : m.room).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); let r;
    if (want === 'PUBLIC') r = findPublic();
    else if (want === '' || want === 'NEW') { r = { code: newCode(), pub: false, players: new Map() }; rooms.set(r.code, r); }
    else { r = rooms.get(want); if (!r) return c.send({ t: 'err', msg: 'No room with code ' + want }); if (r.players.size >= MAX_ROOM) return c.send({ t: 'err', msg: 'That room is full' }); }
    const id = nextId++, P = { id, c, room: r, name: cleanName(m.name) || 'Golfer' + id, eq: cleanEq(m.eq), s: null, rel: 0, holes: 0, lastS: 0, lastChat: 0 };
    c.P = P; r.players.set(id, P);
    c.send({ t: 'hello', ver: PROTO, build: build(), now: Date.now(), id, room: r.code, pub: r.pub, players: [...r.players.values()].filter(x => x !== P).map(pub), board: board(r) });
    cast(r, { t: 'join', p: pub(P) }, P); return;
  }
  const P = c.P; if (!P) return; const r = P.room;
  if (m.t === 's') {                                    // position / state: relayed to the others (max ~20 per second)
    if (now - P.lastS < 45) return; P.lastS = now;
    const sc = String(m.sc || '').replace(/[^\w:]/g, '').slice(0, 16), mode = ['walk', 'cart', 'addr', 'club'].includes(m.m) ? m.m : 'walk';
    const b = Array.isArray(m.b) ? [num(m.b[0]), num(m.b[1]), num(m.b[2]), m.b[3] ? 1 : 0] : null;
    P.s = { sc, x: num(m.x), y: num(m.y), z: num(m.z), yaw: num(m.yaw, 20), m: mode, sp: num(m.sp, 60), b };
    cast(r, Object.assign({ t: 's', id: P.id }, P.s), P); return;
  }
  if (m.t === 'chat') { if (now - P.lastChat < 700) return; const text = cleanText(m.text); if (!text) return; P.lastChat = now; cast(r, { t: 'chat', id: P.id, name: P.name, text }); return; }
  if (m.t === 'score') { P.rel = Math.max(-60, Math.min(80, Math.round(+m.rel || 0))); P.holes = Math.max(0, Math.min(18, Math.round(+m.holes || 0))); cast(r, { t: 'board', list: board(r) }); return; }
  if (m.t === 'eq') { P.eq = cleanEq(m.eq); cast(r, { t: 'eq', id: P.id, eq: P.eq }); return; }
  if (m.t === 'name') { const n = cleanName(m.name); if (n) { P.name = n; cast(r, { t: 'name', id: P.id, name: n }); cast(r, { t: 'board', list: board(r) }); } return; }
  if (m.t === 'bet') {                                  // cart-girl hole bets: relayed to the room, the clients settle them
    if (now - (P.lastBet || 0) < 20) return; P.lastBet = now;
    const k = ['offer', 'cancel', 'accept', 'reject', 'done'].includes(m.k) ? m.k : null; if (!k) return;
    const id = String(m.id || '').replace(/[^\w\-]/g, '').slice(0, 24); if (!id) return;
    cast(r, { t: 'bet', k, id, from: P.id, name: P.name, hole: Math.max(0, Math.min(40, Math.round(+m.hole || 0))), stake: Math.max(1, Math.min(100000, Math.round(+m.stake || 0))), to: Math.round(+m.to || 0), strokes: Math.max(0, Math.min(99, Math.round(+m.strokes || 0))) }, P); return;
  }
  if (m.t === 'mg') {                                   // online versus (cornhole / kart / sled / mini golf): lobby + live game messages, relayed to the room
    if (now - (P.lastMg || 0) < 20) return; P.lastMg = now;
    const g = String(m.g || '').replace(/[^a-z]/g, '').slice(0, 6), k = String(m.k || '').replace(/[^\w]/g, '').slice(0, 10), id = String(m.id || '').replace(/[^\w\-]/g, '').slice(0, 24); if (!g || !k || !id) return;
    const o = { t: 'mg', g, k, id, from: P.id, name: P.name, to: Math.round(+m.to || 0) }; if (Array.isArray(m.d)) o.d = m.d.slice(0, 40).map(v => num(v, 1e6)); else if (g === 'tbl' && m.d && typeof m.d === 'object') { const d = cleanVal(m.d, 0); if (JSON.stringify(d).length <= 8000) o.d = d; }      // a shared table's state (poker, darts)
    cast(r, o, P); return;
  }
  if (m.t === 'ping') { c.send({ t: 'pong', n: m.n, now: Date.now() }); return; }
}
if (require.main === module) server.listen(PORT, () => console.log('Clubhouse multiplayer listening on :' + PORT + ' · serving game build ' + build()));
module.exports = { server, rooms };
