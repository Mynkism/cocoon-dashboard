# Cocoon Dashboard — Change Log

---

**02/06/2026** — Added password protection to the dashboard.

Installed `express-session`. Added session middleware (24-hour expiry, in-memory store) and an auth guard middleware that intercepts all requests before static files and API routes. Unauthenticated visitors are redirected to `/login`. Login page matches dashboard design (black background, card, teal submit button, amber error text, JetBrains Mono input). Password: CrazyGood! Added `/logout` route and a subtle Logout link in the header top-right.
Files changed: `server.js` (session + auth middleware, login/logout routes), `public/index.html` (logout link), `public/style.css` (.logout-btn style).
AI-generated, reviewed by user.

---

**01/06/2026** — Custom Range tab: added two-range comparison mode.

Previously the Custom Range sub-tab showed a single date picker and rendered a single-column summary (Metric | Value).

Changed to require two date ranges (Range A and Range B) displayed inline with a "vs" pill between them. On Apply, both ranges are fetched in parallel and rendered using the same 5-column comparison table format as Month to Date and Month on Month (Metric | Range A | Range B | Change | % Change), including polarity-coloured arrows.

Files changed: `public/app.js` (renderCustomRange), `public/style.css` (added .custom-range-vs).
AI-generated, reviewed by user.
