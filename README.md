# Virtual Temple LIVE 2026 — v3 (Phase 1 + 2)

    client/   Vite + TypeScript + Three.js (scene, avatars, networking)
    server/   Node + Express + Socket.IO (authoritative state, 10 Hz AOI snapshots, /healthz)

## Run locally
    npm run build            # installs + builds client, installs server
    npm start                # http://localhost:3000   (open in 2+ tabs)
    # dev: (terminal 1) node server/index.js  (terminal 2) cd client && npm run dev

## Deploy (Render)
Put this folder in a NEW branch/repo (do not overwrite the working v2). Render Web Service:
Build `npm run build`, Start `npm start`, Health Check `/healthz` (render.yaml included).

## Load test
    cd server && npm install && node tools/loadtest.mjs https://YOUR-URL 500 60

## Not done / not verified
- Never built or run (no network where this was written): run the steps above first.
- 2,000 CCU is a design target only: single Node process, AOI capped at 40 players/snapshot.
  Free Render will not hold it; measure with loadtest and upgrade the plan. Multiple instances need a Redis adapter.
- Not yet: merit system (สาธุ/ดอกบัว), chat/gifts panel, TikTok/Facebook adapters, SQLite, real-phone tests.
