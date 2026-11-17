# Clubhouse — online multiplayer

One tiny Node server does two jobs: it serves the game (`index.html`) and relays multiplayer state over a WebSocket at `/ws`.
No npm packages, no database. Each player's golf physics run on their own device; the server only passes along positions, chat and scores.

## Run it on your computer
```
node server.js
```
Open http://localhost:8080 in two browser windows, click **🌐 Play online → Join public lobby** in each. You'll see each other walking around the clubhouse and on the course.
(Friends on your Wi‑Fi can use `http://<your-computer-IP>:8080`.)

## Put it on the internet (free options)
Any host that runs a Node web service works. Upload this folder (or push it to GitHub) and use:

**Render** (easiest): New → Web Service → connect the repo → Build command: *(leave blank)* → Start command: `node server.js` → Free plan. You get `https://your-name.onrender.com` — share that link and everyone plays there. (Free instances sleep after ~15 min idle; the first visit takes ~30 s to wake.)

**Railway / Fly.io / any VPS**: same idea — `npm start`. The `PORT` environment variable is picked up automatically.

Important: the page must be served by this server (not opened from another site), because the game connects back to the same address. HTTPS is handled by the host (the game automatically uses `wss://`).

## How players use it
- **Public lobby**: drops you into a room with up to 12 golfers (a new room opens when one fills).
- **Private room**: creates a 4‑letter code; friends choose "Join" and type it.
- You see other golfers whenever you're in the same place (same clubhouse room, or the same hole). Press **T** to chat; the 🌐 button shows who's online, where they are, and a live leaderboard (strokes vs par).

## Notes
- Capacity: a single small server handles a few hundred golfers (each sends ~10 updates a second).
- Safety built in: names/chat are sanitised, messages are rate‑limited and size‑capped, max 10 connections per IP.
- Saves (cash, upgrades) stay on each player's own device.
- To update the game later: replace `index.html` with the new build and redeploy.
