# RowVault

**Live:** https://rowvault.vercel.app · **Source:** https://github.com/QuantumGod007/RowVault

Find your film. Claim your seat. A desktop cinema reservation practical built with **Node.js, Express, vanilla JavaScript and SQLite**. Ten bookable Hollywood films, fifteen additional films in a vertically scrolling poster archive, locally cached artwork, and a charcoal / ivory / vermilion interface with Instrument Serif and DM Sans.

## Run

Node.js **22.13+** is required (`node:sqlite` is built in; Node 22 may print an experimental SQLite notice).

```sh
npm install
npm run dev
# or: npm start
```

Open **http://localhost:3000**. `npm test` runs isolated HTTP/database tests; it never touches the demo database. Local development needs no frontend build, API key, or external runtime service.

Configuration: `PORT` (default `3000`), `DATABASE_PATH` (default `data/rowvault.sqlite`), `NODE_ENV`. Set variables in the shell or use `node --env-file=.env server/index.js` with a copy of `.env.example`.

## Node.js Practical Demonstration

1. Open Interstellar → choose a date/time → select C4 and C5 (or any free seats).
2. Continue, enter a name and valid email, and **Confirm Reservation**. Save the ticket reference.
3. Open the same screening again: your seats are disabled. Retrieve the ticket using **My bookings**.
4. In a second terminal, run `npm run demo`. This sends real GET/POST requests: invalid customer data → **422**, successful booking → **201**, identical seats again → **409**, saved-ticket lookup → **200**. It prints the current showtime, seats, total, and reference. Repeated runs choose available seats; this command deliberately creates real demo bookings.
5. To show a browser conflict, open the same screening in two browser tabs, select the same seat in each, then confirm one before the other. The second receives the server conflict and refreshes its map.

Schedules are generated for today and the next four days at 11:00, 15:00 and 19:00 **Asia/Kolkata**. Started shows disappear from selection and remain unbookable on the server. Every film has its own simulated 80-seat auditorium. Standard A–B: ₹250; Prime C–F: ₹350; Recliner G–H: ₹500. Maximum six seats. All screenings are clearly labelled demonstrations; there are no payments or outgoing emails.

**Code to explain in a viva:** `server/app.js` handles Express routing and request/response status codes. `server/validation.js` independently validates types, required values, lengths, email, duplicate/invalid seats, and unexpected properties (including prices). `server/reservations.js` checks showtime expiry, seat membership and availability, calculates prices, and saves the reservation in one `BEGIN IMMEDIATE` transaction. `server/database.js` creates foreign keys and a unique `(showtime_id, seat_id)` constraint. Conflicting or invalid claims roll back completely. Bookings survive restarts. Lookups use unpredictable 96-bit references and omit customer details.

### API

All API responses use `{ success: true, data }` or `{ success: false, error, message, fields?, unavailableSeats? }`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | App/database health |
| GET | `/api/movies` | Static seeded catalog |
| GET | `/api/movies/:id` | Film details |
| GET | `/api/movies/:id/showtimes` | Upcoming screenings and free-seat counts |
| GET | `/api/showtimes/:id/seats` | Actual availability and server prices |
| POST | `/api/reservations` | Validate and atomically reserve seats |
| GET | `/api/reservations/:reference` | Retrieve saved ticket without customer information |

POST body (replace `showtimeId` with an upcoming ID from GET showtimes):

```json
{"showtimeId":1,"seatIds":["C4","C5"],"customerName":"Demo Guest","customerEmail":"demo@example.com"}
```

Status codes: **200** retrieved; **201** created; **400** malformed JSON/body/ID/reference; **404** unknown resource; **409** seat conflict; **413** body over 8 KB; **422** field errors, unexpected properties, invalid seats or expired screening; **500** unexpected error, without internal details.

## Deployment

**Vercel:** the root `app.js` exports the Express app; `vercel.json` configures the runtime and security headers. Connect a **Turso Starter ($0/month)** database from the Vercel Marketplace to production, supplying `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then run `vercel --prod`. Marketplace terms must be accepted by the account owner before database provisioning. Verify `/api/health`, book seats, then repeat the request to confirm a **409** conflict.

Vercel cannot persist a local SQLite file. The hosted adapter in `server/cloud-store.js` uses remote SQLite-compatible libSQL write transactions and the same schema and server validation. `npm start` continues to use the original on-disk SQLite backend for the practical. The test suite covers both adapters, competing claims, rollback and persistence. Credentials and local bookings are excluded from Git.

**Docker / Render:** `Dockerfile` and `render.yaml` remain available for conventional persistent-disk hosting. Run `docker build -t rowvault .`, then `docker run -p 3000:3000 -v rowvault-data:/data rowvault`. Keep the disk mounted at `/data`; do not use independent replicas with separate local databases.

## Film & image credits

Cached promotional posters and cinematic backdrops (including the 3840×2160 Dune hero): **TMDB**, with per-film URLs in [`public/assets/sources.json`](public/assets/sources.json) plus gallery-only sources in [`public/assets/archive-sources.json`](public/assets/archive-sources.json), and metadata references in [`public/assets/metadata-sources.json`](public/assets/metadata-sources.json). Local smaller copies of each exact poster serve as fallbacks. There is no runtime movie API. US classifications are reference labels; regional cuts may have different runtimes.

This is a personal, noncommercial academic demonstration under [TMDB’s terms](https://www.themoviedb.org/terms-of-use). Film artwork remains copyrighted by the respective rights holders. Attribution does not itself grant third-party rights; review permission before public redistribution or commercial use. The in-app credits include the official TMDB mark and attribution notice.

Instrument Serif and DM Sans are bundled under the SIL Open Font License; see `public/assets/FONT-LICENSES.txt`.
