# MeterMind — Home Energy Monitor

A web application that monitors household electricity consumption via a Tuya / Smart Life smart meter and sends email alerts when usage exceeds configured limits.

The owner connects their Tuya energy meter, sets a kWh threshold for a time window (day / week / month), and provides an email address. Three background jobs run hourly to sync readings, evaluate limits, and dispatch breach notifications — no manual meter checks required.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Astro 6 + React 19, TypeScript |
| Database & Auth | Supabase (PostgreSQL, email/password auth, RLS) |
| Smart meter API | Tuya IoT Platform (OAuth H5 flow) |
| Email | Resend (transactional breach alerts) |
| Runtime | Cloudflare Workers (SSR + Cron Triggers) |
| Testing | Vitest (unit/integration), Playwright (E2E) |

## Prerequisites

- **Node.js** ≥ 22 (see `.nvmrc`)
- **npm**
- **Supabase** project — cloud or local via Docker (`npx supabase start`)
- **Tuya Developer Console** account with an IoT Cloud project
- **mkcert** for local HTTPS (required by Tuya OAuth callback)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .dev.vars
```

Fill in the values — at minimum `SUPABASE_URL`, `SUPABASE_KEY`, `TUYA_CLIENT_ID`, and `TUYA_CLIENT_SECRET`. See `.env.example` for the full variable list with comments.

For local Supabase:

```bash
npx supabase start
```

Copy the `anon key` and `API URL` from the CLI output into `.dev.vars`.

### 3. Apply database migrations

```bash
# Local (resets and reapplies all migrations)
npx supabase db reset

# Cloud
npx supabase link --project-ref <ref>
npx supabase db push
```

### 4. Generate local HTTPS certificates

Tuya's OAuth H5 redirect requires an HTTPS callback URL, even in development.

```bash
npm run certs:generate
```

This uses [mkcert](https://github.com/FiloSottile/mkcert) to create trusted certificates in `certs/`. Install mkcert first if you don't have it:

```bash
# Windows
winget install FiloSottile.mkcert

# macOS
brew install mkcert
```

### 5. Start the dev server

```bash
npm run dev:https
```

Open **https://127.0.0.1:3000**. Register the same URL as the OAuth callback in Tuya Developer Console:

```
https://127.0.0.1:3000/dashboard/tuya/callback
```

> For features that don't involve Tuya OAuth you can use plain `npm run dev` (HTTP on port 4321) instead.

## Usage

1. **Sign up** at `/auth/signup`, then **sign in** at `/auth/signin`.
2. **Connect your Tuya account** — click the connect button on the dashboard, authorize via Tuya's OAuth page, then select your energy meter device from the list.
3. **Set a consumption limit** — choose a time window (day, week, or month) and enter a kWh threshold.
4. **Configure alarm email** — enter the address where breach alerts should be sent.
5. **Done.** The system syncs meter readings, evaluates limits, and sends email notifications automatically every hour. You can also trigger a manual sync from the dashboard.

## Background Cron Jobs

Three hourly UTC cron triggers run on Cloudflare Workers:

| Schedule (UTC) | Job | Route |
|---|---|---|
| `:00` every hour | Tuya reading sync | `POST /api/cron/sync-readings` |
| `:05` every hour | Limit evaluation | `POST /api/cron/evaluate-limits` |
| `:10` every hour | Breach email dispatch | `POST /api/cron/send-notifications` |

Additional secrets required for cron and email — see `.env.example`:

| Variable | Source |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → `service_role` |
| `CRON_SECRET` | Any random string (Bearer auth for cron routes) |
| `RESEND_API_KEY` | Resend dashboard → API Keys |
| `RESEND_FROM_EMAIL` | Verified sender address in Resend |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (HTTP) |
| `npm run dev:https` | Start dev server over HTTPS on `https://127.0.0.1:3000` |
| `npm run build` | Production build |
| `npm run test` | Run unit and integration tests (Vitest) |
| `npm run test:e2e` | Run E2E tests (Playwright) |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run certs:generate` | Generate local HTTPS certificates via mkcert |

## Deployment

Deploys to [Cloudflare Workers](https://workers.cloudflare.com/):

```bash
npm run build
npx wrangler deploy
```

Set secrets in Cloudflare via `npx wrangler secret put <NAME>` or the dashboard.

> Always deploy using the root `wrangler.jsonc` — it includes the `scheduled` cron handler. Deploying only the Astro SSR bundle skips cron jobs.

## License

MIT
