# BiteVo Admin — Frontend

React 18 + Vite admin panel for BiteVo. Works on phones and computers, with the same look as the BiteVo website.
It talks to the API in `../backend`.

## Run it

Start the backend first (`cd ../backend && npm install && npm run dev`), then:

```bash
npm install
npm run dev
```

Open http://localhost:2001. In development, `/api` and `/uploads` are forwarded to the backend on port 4000.
To work against another backend instead, e.g. the live one, put `API_PROXY_TARGET=https://adminapi.bitevo.in`
in `.env` (no local backend needed then).

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 2001 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build locally |

Sign in with the admin account listed in `../backend/README.md`.

## Production

**On the BiteVo server (admin.bitevo.in), fastest:** build the panel and let the backend serve it. nginx forwards
admin.bitevo.in to the backend's port, the same as adminapi.bitevo.in. The backend gzips everything and lets
browsers keep the built JS/CSS for a year, so a reload only fetches the page and the data. No Vite process runs:

```bash
npm ci && npm run build       # then: pm2 restart <backend>
```

Never serve the panel with `npm run dev` on the server: it sends ~36 unminified files (about 3 MB, ~10 s over the
internet) instead of one 93 KB script. If you'd rather keep a Vite process, use the built panel with
`pm2 start npm --name bitevo-admin-web -- run preview` (after `cp .env.example .env`). Vite only answers on the host
names in `ALLOWED_HOSTS` in `vite.config.js` (plus localhost).

Or, more generally, let the backend serve the build. `npm run build` here, then `npm start` in `../backend` (or just
`npm run host` there, which does both). The panel and API then share one address, e.g. http://localhost:4000, and
`VITE_API_URL` stays empty.

Or build with the API's address and host `dist/` on any static host:

```bash
VITE_API_URL=https://api.your-domain npm run build
```

(On Windows PowerShell: `$env:VITE_API_URL="https://api.your-domain"; npm run build`, or put `VITE_API_URL=...` in `.env`.)
The backend must list this site in `CLIENT_ORIGIN`.

## Pages

Dashboard · Orders · Products (with **combos**, photo upload, custom categories, headings) · Coupons (percentage,
flat, free delivery, free product, wallet cashback) · Wallet · Delivery agents · Login status · Analytics.

**Categories:** in the product form, *+ Add a new category…* opens a popup; the new category is saved to the
database immediately and selected.

**Combos:** *Add combo* on the Products page picks dishes and quantities, shows what they cost separately and how
much customers save, and works out veg/non-veg automatically.

## On phones

Bottom tab bar (Home, Orders, Menu, Wallet, More), table rows as cards, dialogs that slide up from the bottom, and
swipeable filters. Choose *Add to Home Screen* in Chrome or Safari to open it full-screen like an app.

## Code

```
src/
  api/index.js   every call to the backend
  pages/         one file per page
  components/    layout (sidebar, phone tab bar), shared UI, charts, photo picker, icons
  lib/           formatting, status labels, image shrinking, data hooks
```
