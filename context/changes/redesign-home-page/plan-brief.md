# Home Page Redesign — Plan Brief

> Full plan: `context/changes/redesign-home-page/plan.md`

## What & Why

The current home page is a generic starter template ("10x Astro Starter") with English copy, cosmic/space-themed visuals, and feature cards describing the tech stack — none of which reflects the actual product. The app is a Polish-language home energy consumption monitor with Tuya smart meter integration, consumption limits, and email alerts. The home page needs to communicate what the product does and match the rest of the app's language and purpose.

## Starting Point

The home page (`src/pages/index.astro`) renders a `Welcome.astro` component with a dark cosmic background (animated purple orbs, star field), a "10x Astro Starter" hero heading, English tagline, Sign In / Sign Up buttons, and three generic feature cards. A `Topbar.astro` bar shows auth state. All styling is Tailwind with purple accents. The dashboard already uses Polish copy.

## Desired End State

The home page shows a clean, energy-themed Polish landing page. Users see the product name, a Polish description of what the app does, and three feature cards highlighting Tuya integration, consumption monitoring, and limit alerts. Logged-in users see a "Go to Dashboard" CTA instead of sign-in buttons. The page ships zero client-side JavaScript.

## Key Decisions Made

| Decision               | Choice                                           | Why (1 sentence)                                                             |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Visual direction       | Energy-themed refresh (blues/teals)              | Aligns visual identity with the product domain without a full brand overhaul |
| Language               | Polish only                                      | Matches the rest of the app; single-household solo-user product              |
| Feature cards          | Product capabilities (Tuya, consumption, alerts) | Tells users exactly what they get — maps to completed MVP slices             |
| Topbar                 | Restyle with app name, keep auth logic           | Consistent look with minimal risk; nav links would be mostly empty           |
| Page sections          | Hero + features + simple footer                  | Clean and fast to build — enough for a personal-use MVP                      |
| Component architecture | Pure Astro (no React islands)                    | Zero JS on landing page; avoids hydration issues documented in lessons.md    |
| Auth-aware CTA         | Show "Dashboard" when logged in                  | Better UX — no reason to show sign-in to authenticated users                 |

## Scope

**In scope:**

- New energy-themed background utility (`bg-energy`) in global.css
- Polish hero copy with product name and description
- Three product-capability feature cards with Lucide SVG icons
- Auth-aware hero CTA (dashboard vs sign-in/up)
- Restyled Topbar with app name branding
- Minimal footer
- `<html lang="pl">` and Polish page title

**Out of scope:**

- Dashboard styling changes
- i18n or English support
- React islands or client-side JS
- Auth page redesign
- Custom illustrations or image assets
- Multi-section landing page (how-it-works, testimonials)

## Architecture / Approach

All changes are to Astro template files and one CSS utility — no new components, no JS, no data fetching. The `bg-cosmic` utility is left untouched (dashboard depends on it); a new `bg-energy` utility provides the home page background. Auth state is read from `Astro.locals.user` (same server-side pattern already used by Topbar).

## Phases at a Glance

| Phase                               | What it delivers                          | Key risk                                                         |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| 1. Visual Theme Update              | Energy-themed background + teal Topbar    | Color choices may need iteration after seeing them live          |
| 2. Content and Feature Cards        | Polish hero copy + product feature cards  | Copy quality — may need user review for tone                     |
| 3. Auth-Aware CTA, Footer, Metadata | Conditional CTA, footer, lang="pl", title | E2E tests may rely on English text or specific element structure |

**Prerequisites:** Dev server running locally for manual verification
**Estimated effort:** ~1-2 sessions across 3 phases

## Open Risks & Assumptions

- The product name ("Monitor Energii" or similar) is a placeholder — user may want a specific brand name
- Changing `<html lang="en">` to `lang="pl"` affects all pages including auth pages that may still have some English UI strings
- Existing E2E tests may assert on English text ("Sign In", "Sign Up") that will change to Polish

## Success Criteria (Summary)

- Home page communicates the product's purpose in Polish to a first-time visitor
- Logged-in users see a clear path to the dashboard without redundant sign-in buttons
- Zero client-side JavaScript shipped on the landing page
