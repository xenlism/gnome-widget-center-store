# GNOME Widget Center Store

A store website for the `gnome-widget-center` GNOME Shell extension: submit,
review, approve, download `.gwcw` (widget) and `.gwct` (theme pack)
packages, with ratings/comments and an admin dashboard. Built to run
entirely on Cloudflare's **free tier** — Workers, D1, R2, static assets —
with the highest-traffic path (browsing + downloading) costing zero
Worker requests.

## Architecture at a glance

- **Frontend** — plain HTML/CSS/JS in `public/`, no build step, dark
  theme, responsive. Served directly by Cloudflare as static assets; the
  Worker is never invoked for these requests.
- **API** (`src/`) — a single Worker, plain `fetch()` routing, zero
  runtime dependencies (no framework, no JWT/bcrypt library — everything
  auth-related uses the Workers-native Web Crypto API).
- **D1** (`migrations/0001_init.sql`) — users, widgets, themepacks,
  reviews. Rating averages are kept in sync by SQL triggers, so listing
  pages never run `SUM()`/`AVG()` over reviews.
- **R2, two buckets**:
  - `gwc-store-public` — approved files + the two manifests
    `repo/widgets.json` / `repo/themepacks.json`. Gets a
    public custom domain; the GNOME extension and the website's home
    page both fetch these manifests directly from here, never through the
    Worker.
  - `gwc-store-pending` — unreviewed submissions. **Never** gets public
    access. A `.gwcw`'s `widget.js` runs unsandboxed inside the user's
    GNOME Shell process once installed, so unapproved code must stay
    unreachable except through the admin-only
    `/api/admin/:type/:id/download` route.
- **Email** — Resend (free: 3,000 emails/month, no paid-plan
  prerequisite) for the registration verification link. Cloudflare's own
  email sending requires the $5/mo Workers Paid plan; MailChannels' old
  free relay for Workers ended 2024-08-31 — Resend is the current best
  fit for "free tier only."

Everything in `src/` was exercised by `test/integration.test.mjs`
against a real SQLite engine (Node's `node:sqlite`) before being handed
to you — register → verify → login, submit → admin approve → catalog
regeneration, the rating trigger, and a banned user being blocked from a
still-valid session cookie. Run `npm test` to see it yourself.

## Prerequisites

- A Cloudflare account (free plan is fine)
- Node.js 20+ and `npm`
- A [Resend](https://resend.com) account (free) and a domain you can add
  a sender for — or use their test sender while trying things out
- The [`wrangler`](https://developers.cloudflare.com/workers/wrangler/)
  CLI (installed via `npm install` below)

## 1. Clone and install

```bash
git clone <this-repo-url>
cd gnome-widget-center-store
npm install
npx wrangler login
```

> Note: this repo doesn't ship a `package-lock.json` (it was generated
> offline, without registry access, for you to fill in). `npm install`
> creates one on first run — commit it afterwards so `npm install` in CI
> resolves the exact same versions every time.

## 2. Create the D1 database

```bash
npx wrangler d1 create gwc-store
```

Copy the `database_id` it prints into `wrangler.toml` under
`[[d1_databases]]`.

Apply the schema:

```bash
npm run migrate:local    # for `wrangler dev`
npm run migrate:remote   # for production, once deployed
```

## 3. Create the two R2 buckets

```bash
npx wrangler r2 bucket create gwc-store-public
npx wrangler r2 bucket create gwc-store-pending
```

In the Cloudflare dashboard, go to **R2 → gwc-store-public → Settings →
Public Access** and connect a custom domain (e.g. `files.example.com`).
**Do not** enable public access on `gwc-store-pending` — leave it
Worker-only.

## 4. Edit `wrangler.toml`

Fill in:
- `database_id` (from step 2)
- `SITE_URL` — where the site itself will live
- `PUBLIC_FILES_BASE_URL` — the custom domain you connected in step 3
- `EMAIL_FROM` — a sender address verified on your Resend domain

Also edit `public/js/config.js` and set `FILES_BASE` to the same value
as `PUBLIC_FILES_BASE_URL` (the frontend is static, so it can't read
`wrangler.toml` — this is the one place that value has to be duplicated).

## 5. Set secrets

```bash
npx wrangler secret put JWT_SECRET        # any long random string
npx wrangler secret put RESEND_API_KEY    # from resend.com
```

## 6. Deploy

```bash
npm run deploy
npm run migrate:remote
```

## 7. Create your first admin

There's a deliberate chicken-and-egg gap here: creating a user via the
admin dashboard requires being an admin already. For the *first* admin,
register a normal account on the live site, then promote it directly in
D1:

```bash
npx wrangler d1 execute gwc-store --remote \
  --command "UPDATE users SET is_admin = 1, is_email_verified = 1 WHERE email = 'you@example.com'"
```

After that, use the admin dashboard's "เพิ่มผู้ใช้ใหม่" (add user) form
for everyone else.

## 8. Continuous deployment (optional)

Add two repository secrets in GitHub (**Settings → Secrets and
variables → Actions**): `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. `.github/workflows/deploy.yml` will then apply
migrations and deploy on every push to `main`.

## Local development

```bash
npm run dev
```

This runs the Worker + static assets locally against a local D1/R2
emulation. Register/login work end-to-end; outbound email will fail
locally unless you also set `RESEND_API_KEY` in a `.dev.vars` file
(gitignored) — that's expected and harmless for local testing.

## Running the tests

```bash
npm test
```

Runs `test/integration.test.mjs`, which drives the actual route handlers
in `src/` against a real in-memory SQLite database (via Node's
`node:sqlite`) and a mocked R2, covering the flows listed above.

## Known gaps / intentionally out of scope for v1

- **`download_count` is not live.** Real downloads hit R2 directly and
  never touch the Worker, so there's nothing to increment in the
  request path by design. The intended pattern (not yet wired up) is: log
  a download event to **Analytics Engine** (free, effectively unlimited
  writes) from a tiny beacon endpoint, and have the `scheduled()` cron in
  `src/index.js` (currently a no-op stub, runs daily at 03:00) bulk-update
  `download_count` once a day. This keeps the highest-volume number off
  D1's 100K rows-written/day budget.
- **No password reset flow.** Only registration + email verification is
  implemented. Add a `password_resets` table (same shape as
  `email_verifications`) if you need this.
- **The GNOME extension side isn't part of this repo.** This is the
  store backend + website only — wiring the "Store" tab in the
  extension's overlay/prefs to fetch the manifests and unzip a
  downloaded `.gwcw` into `~/.local/share/gnome-widget-center/widgets/`
  is a separate piece of work in the extension's own codebase.
