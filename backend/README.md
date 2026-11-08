# BiteVo Admin — Backend

Node.js + Express API for the BiteVo admin panel. Data is stored in MongoDB.

## Run it

```bash
npm install
npm run dev
```

The API listens on http://localhost:4000. Start the frontend separately (see `../frontend`).

## Host it on this computer

Run `npm install` here and in `../frontend` once, then:

```bash
npm run host
```

This builds the panel and serves the panel and the API together at **http://localhost:4000**. One process, no Vite
dev server. `npm start` serves the last build without rebuilding. By default only this computer can open it; to use it
from a phone on the same Wi-Fi, set `HOST=0.0.0.0` in `.env`, but set a strong admin password first, because anyone
on that network can then reach the sign-in page.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API on port 4000 and restarts on changes |
| `npm run host` | Builds the panel (`../frontend`) and serves panel + API on port 4000 |
| `npm start` | Runs the API for production (port from `PORT`); also serves the panel if `../frontend/dist` exists |
| `npm run seed` | Loads demo data into an **empty** database (never touches real data) |
| `npm run seed -- --reset` | Replaces existing *demo* data with fresh demo data |
| `npm run check-db` | Read-only: lists the databases and collections the API can see |
| `npm run create-admin -- --email you@bitevo.in --name "Your Name"` | Creates an admin, or resets its password (asks for it) |
| `npm run move-uploads` | Moves old `/uploads/…` photos to Supabase Storage (dry run; add `--apply`) |

## Settings (`.env`)

Copy `.env.example` to `.env`. The MongoDB connection is either `MONGODB_URI`, or `MONGO_DB_URL` with
`MONGO_DB_USER` / `MONGO_DB_PASSWORD`. Data goes in the `bitevo` database (`MONGO_DB_NAME`). Without a connection
string the API uses a local JSON file (`data/db.json`) instead. **Never commit `.env`**: it holds the database password
(it's in `.gitignore`).

Demo mode seeds an empty database with 180 days of demo data, simulates new orders and deliveries, and allows
"reset demo data". It's on by default only with the local JSON file. With MongoDB it's off unless `DEMO_MODE=true`,
so the real database never gets fake orders by accident. Don't set it on the live server.

### Demo sign-in

| Email | Password | Role |
|---|---|---|
| admin@gmail.com | admin | Super admin |
| ops@bitevo.in | bitevo@ops | Operations |

Created by the demo seeder. Before going online, create your own admin with `create-admin` and set `DEMO_MODE=false`.

## API

Everything is under `/api` and needs a signed-in admin, except `/api/auth/login` and `/api/health`.

| Area | Routes |
|---|---|
| Sign-in | `POST /auth/login`, `GET /auth/me`, `POST /auth/heartbeat`, `POST /auth/logout` |
| Menu | `GET/POST /products`, `PATCH/DELETE /products/:id`, `GET/POST /categories`, `POST /uploads` (raw image body) |
| Offers | `GET/POST /coupons`, `PATCH/DELETE /coupons/:id` |
| Orders | `GET /orders?days=1`, `GET /orders/:id`, `POST /orders/:id/advance`, `/assign`, `/cancel` |
| Wallets | `GET /wallets`, `POST /wallets/:customerId/adjustments`, `GET /customers?search=` |
| Team | `GET/POST /agents`, `PATCH/DELETE /agents/:id` |
| Rider applications | `GET /rider-applications`, `POST /rider-applications/:id/contacted`, `/approve` (adds the applicant as an agent, ID check pending), `/reject` |
| Login status | `GET /sessions`, `POST /sessions/:id/revoke`, `GET /login-events` |
| Reports | `GET /analytics?days=30`, `GET /dashboard` |
| Settings | `GET /settings`, `PATCH /settings` (zones, vehicle types, cancel reasons, wallet reasons) |
| Demo | `POST /demo/reset` (demo mode only) |

**Settings:** delivery zones, vehicle types, cancel reasons and wallet adjustment reasons live in the `settings`
collection (document `app`); agent and order checks use them.

**Refund requests** (`src/routes/refundRequests.js`, page *Refund requests*): customers ask for a refund on the
website's order page (a complaint about the food, missing or wrong items…), choosing UPI / card or the BiteVo
wallet. Nothing is refunded until an admin approves a request here, setting the amount and where it goes; or
rejects it with a note the customer sees. A delivered or cancelled order can also be refunded from its page
(*Refund*, with a reason), which shows on the Refund requests page as approved. All of these go through
`src/lib/refunds.js`: one refund per order; the part paid online goes back through Razorpay when sent to the source,
the rest (wallet, cash) to the BiteVo wallet. The website emails the customer the outcome.

| Refund requests | `GET /refund-requests`, `POST /refund-requests/:id/approve` `{ amount, to, note }`, `/reject` `{ note }`; `POST /orders/:id/refund` `{ amount, to, reason }`, `GET /orders/:id/refundable` |

**Refunds to UPI / card:** cancelling an order the customer paid online (website or app, through Razorpay) with
"Refund to UPI/Card" sends the online part back through Razorpay first (`src/lib/razorpay.js`; 5–7 working days for
the customer) and anything paid from the wallet back to the wallet. It needs the Razorpay keys in `.env`:
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, or `ROZERPAY_API` / `ROZERPAY_SECRET` (the website API's keys). Without
them, or if Razorpay refuses, the order is not cancelled and the panel says why; refund to the wallet instead. The
order shows the Razorpay refund ID, and "done" once Razorpay confirms it (the website API's Razorpay webhook).

**Photos** are uploaded with `POST /api/uploads` (signed-in admin; the image file as the raw body with
`Content-Type: image/jpeg`, `image/png`, `image/webp` or `image/gif`; at most 5 MB). The answer is
`201 { "url": "https://<project>.supabase.co/storage/v1/object/public/bitevo-images/<id>.jpg" }`. Save that link
in a product's or category's `image`. It's a public Supabase Storage link, so the website (bitevo.in) and the apps
show it as it is, with no extra setup. The `bitevo-images` bucket is created as public the first time a photo is
saved. Without the Supabase settings, photos fall back to the local `uploads/` folder (`/uploads/<id>.jpg`).

```bash
curl -b "bitevo_admin_session=<cookie>" -H "Content-Type: image/jpeg" --data-binary @dish.jpg https://adminapi.bitevo.in/api/uploads
```

Photos uploaded before Supabase (links like `/uploads/x.jpg`) are moved with `npm run move-uploads` (dry run;
add `--apply`, and `--from https://adminapi.bitevo.in` to fetch files that are only on the server).

**Categories** are added from the panel's product form ("+ Add a new category…" opens a popup that saves the
name straight to the `categories` collection).

**Combos** are products with `type: "combo"` and `comboItems: [{ productId, qty }]`. The server fills in item
names, works out veg/non-veg from the items, keeps names in sync when a dish is renamed, and won't delete a dish that
is part of a combo.

## Security

- Admin passwords are bcrypt hashes; sessions use an httpOnly cookie whose token is stored only as a SHA-256 hash.
- Sign-in is rate limited (10 attempts / 15 min / IP) and logged.
- Input is whitelisted and validated; uploads must be real images; security headers via helmet (with a
  Content-Security-Policy for the served panel); CORS limited to `CLIENT_ORIGIN`.
- Listens on `127.0.0.1` (this computer only) unless `HOST` says otherwise.

## Going live

- Host on any Node.js host with the `.env` settings, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` behind a proxy.
- If the panel is on another domain: `CLIENT_ORIGIN=https://admin.your-domain`, `COOKIE_SAMESITE=none`, `PUBLIC_URL=https://api.your-domain`.
- Uploaded photos go to Supabase Storage (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`), so nothing needs to stay on the
  server's disk. Keep the secret key on the server only; it's never sent to the browser.
- Never set `DEMO_MODE=true` on the real database: demo mode keeps placing fake orders (and marking them
  delivered) in whatever database it's connected to. With MongoDB it's off unless set.
- **Live updates** come over a WebSocket at `/api/ws` (`src/live.js`): MongoDB change streams on `orders` and
  `agents` tell the panel's Orders and Team pages the moment an order is placed on the website, moved along here
  or by a rider in the rider app, or a rider goes online, offline or out on a delivery. It needs MongoDB as a
  replica set (any Atlas cluster is). Behind nginx, pass the upgrade on, or the pages fall back to refreshing
  every 30 s:

  ```nginx
  location /api/ws {
      proxy_pass http://127.0.0.1:4000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 1h;
  }
  ```

## Code

```
src/
  server.js, app.js  start-up, middleware, route table
  auth.js            sessions and the "must be signed in" guard
  routes/            auth, products (+categories, uploads), coupons, agents, riderApplications, orders, wallets (+customers), activity, reports
  db/                MongoDB store, JSON-file fallback, indexes
  demo/              demo data, seeding rules, live order simulator
  analytics.js       dashboard and analytics maths
```
