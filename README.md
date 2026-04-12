# name-survey

A live naming survey for the Orchestration Engine with:

- React 19 frontend
- Parcel build pipeline
- Express API for persistent server-side state
- Ephemeral hashed admin authentication
- Admin-only IP visibility
- Admin-only survey ending and reset with password re-entry
- Public final-results view and Pac-Man finale after the survey ends
- Retro-modern CMYK visual theme

## Security model

This project generates a fresh random admin password each time the server starts.

The server hashes that password in memory and logs the plaintext password to the server console once at boot. Restarting the server rotates it.

Admin-only actions are enforced on the server. Public users can never end or reset the survey.

## Quick start

1. Copy `.env.example` to `.env`
2. Set `SESSION_SECRET`
3. Install dependencies
4. Run dev mode
5. Copy the boot-time admin password from the server console

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:1234`  
API/server: `http://localhost:8787`

## Production build

```bash
npm run build
npm start
```

Then open `http://localhost:8787`.

## Environment variables

- `HOST` – bind host for the Express server, default `127.0.0.1`
- `PORT` – server port, default `8787`
- `ALLOWED_ORIGINS` – comma-separated frontend origins allowed to call the API in dev, default `http://127.0.0.1:1234,http://localhost:1234`
- `SESSION_SECRET` – used to sign the session cookie
- `TRUST_PROXY` – set to `true` when deployed behind a reverse proxy or load balancer
- `NETLIFY_BLOBS_SITE_ID` – optional manual Netlify Blobs site/project ID override
- `NETLIFY_BLOBS_TOKEN` – optional manual Netlify Blobs token override

## Behavior notes

- The app enforces one vote per participant name.
- Voting is disabled once the survey ends.
- IPs are recorded per response and summarized in the UI.
- Public users see masked IPs.
- Admin users see full IPs and participant names associated with each IP.
- Reset is admin-only and requires the password again before data is wiped.
- End survey is admin-only.
- Once an admin ends the survey, everyone sees the final ranking.
- The Pac-Man finale runs for all viewers after the survey ends.
- The finale eats the runner-up rows from `#5` through `#2`.
- The admin password is regenerated on every server start and printed to the server console.
- The reset and login endpoints have simple per-IP throttling.

## File structure

```text
.
├── data/
├── src/
│   ├── index.html
│   ├── index.jsx
│   └── styles.scss
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js
```

## Deployment note

If you deploy behind a proxy, set `TRUST_PROXY=true` so Express uses forwarded IP headers correctly and session cookies can work with `secure: "auto"`.

## Netlify note

This repo is now wired so Netlify can serve the frontend from `dist` and route `/api/*` requests to an Express-based Netlify Function.

Survey state is stored in `data/survey-state.json` for local development.
On Netlify, the app tries Netlify Blobs first and falls back to in-memory runtime state if Blobs is unavailable.
The in-memory fallback keeps the site working, but state can reset whenever the function instance is recycled.

## Privacy note

Showing IP addresses in a meeting room can be sensitive. This build defaults to masked public display and reserves full IP visibility for the authenticated admin session.
