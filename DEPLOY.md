# Put Clubhouse online (free) — about 10 minutes

You need two free accounts: **GitHub** (github.com) and **Render** (render.com — sign up with your GitHub account).

## 1. Put the files on GitHub
1. On github.com click **+ → New repository**. Name it `clubhouse-golf`, keep it Public or Private, click **Create repository**.
2. Click **uploading an existing file**, drag in everything from this folder (`index.html`, `server.js`, `package.json`, `render.yaml`, `.gitignore`, `README.md`, `DEPLOY.md`), and click **Commit changes**.

## 2. Deploy on Render
1. On render.com click **New + → Blueprint** (or **Web Service** if you prefer), and pick your `clubhouse-golf` repo.
2. Render reads `render.yaml` and fills everything in (free plan, start command `node server.js`). Click **Apply / Create**.
3. Wait 1–2 minutes for the status to turn **Live**. Your link looks like `https://clubhouse-golf.onrender.com`.

## 3. Play together
Open the link on two devices, tap **🌐 Play online → Join public lobby** on each — you'll see each other. For friends only, use **Private room** and share the 4-letter code.

## Good to know
- Free servers sleep after ~15 minutes with nobody online; the first visit afterwards takes ~30 seconds to wake. Upgrading to the ~$7/month plan removes this.
- Saves (cash, purchases) stay on each player's own device for now.
- To update the game later: replace `index.html` in the repo (GitHub → file → edit/upload) — Render redeploys automatically.
- Health check: open `/healthz` on your link; it should say `ok`.
