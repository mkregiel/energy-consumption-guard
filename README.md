# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run dev:https` - Start dev server over HTTPS on `https://127.0.0.1:3000` (required for Tuya OAuth)
- `npm run certs:generate` - Generate local mkcert certificates for HTTPS dev
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier

## Project Structure

```md
src/
├── layouts/           # Astro layouts
├── pages/             # Astro pages (routes)
│   ├── api/           # API endpoints (SSR, zod-validated)
│   │   └── auth/      # signin, signup, signout
│   └── auth/          # signin, signup, confirm-email
├── components/        # UI (Astro for static; React when interactive)
│   ├── auth/          # sign-in/up forms and shared auth UI
│   └── ui/            # shadcn/ui primitives
├── lib/               # Supabase client, helpers, config
├── types.ts           # Shared domain entity/DTO types
├── styles/            # Global CSS (Tailwind)
├── middleware.ts      # Session resolution; protected routes
└── env.d.ts           # Astro/env type declarations
```

## Local HTTPS for Tuya OAuth

Tuya Developer Console rejects callback URLs that do not use `https://`. Default `npm run dev` serves HTTP on port 4321, which cannot be registered as an OAuth redirect.

1. Install [mkcert](https://github.com/FiloSottile/mkcert) (`winget install FiloSottile.mkcert`)
2. Generate certificates: `npm run certs:generate`
3. Start HTTPS dev server: `npm run dev:https`
4. Open `https://127.0.0.1:3000` (no browser cert warning when mkcert CA is trusted)
5. Register callback URL in Tuya Developer Console: `https://127.0.0.1:3000/dashboard/tuya/callback`
6. Set `TUYA_API_BASE_URL` to the same regional OpenAPI host as the H5 page (e.g. `https://openapi.tuyaeu.com` for Central Europe)

Use `dev:https` for all Tuya OAuth manual tests — not default `npm run dev`. See `certs/README.md` for regeneration steps.

After linking Tuya, open **`/dashboard`** to register a meter and view consumption. Set `TUYA_OAUTH_REDIRECT_URI` in `.env` to match the callback URL registered in Tuya console (see `.env.example`).

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

Local Supabase `site_url` is set to `https://127.0.0.1:3000` to align with HTTPS dev. Sign in via `npm run dev:https` when testing Tuya flows.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Database migrations

The energy monitoring domain lives in five `public` tables: `meters`, `consumption_limits`, `consumption_readings`, `notification_settings`, and `limit_breach_events`. SQL migrations are in `supabase/migrations/`; shared TypeScript types are in `src/types.ts`.

**Local development** (with Docker running):

```bash
npx supabase start
npx supabase db reset
```

`db reset` reapplies all migrations on a fresh local database. Auth still uses the built-in `auth.users` table.

**Production** — requires explicit human approval before changing RLS or schema (see `context/deployment/deploy-plan.md`):

1. Review migration SQL in the PR.
2. After approval: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Verify tables in the Supabase dashboard.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`:

- Page routes: add paths to `PROTECTED_ROUTES` (e.g. `/dashboard`) — unauthenticated users are redirected to `/auth/signin`.
- API routes: all `/api/*` paths require a session **except** `/api/auth/*` (sign-in, sign-up, sign-out). Unauthenticated API requests receive JSON `401` with `error.code: "UNAUTHORIZED"`. Handlers should still call `requireUser()` from `src/lib/auth-guard.ts` for defense in depth.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs lint + build on every push and PR to `master`. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step.

## License

MIT
