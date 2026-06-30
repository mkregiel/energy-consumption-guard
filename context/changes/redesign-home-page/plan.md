# Home Page Redesign Implementation Plan

## Overview

Replace the generic "10x Astro Starter" home page with a product-specific Polish-language landing page for the energy consumption monitoring app. The current page has placeholder content (cosmic theme, English copy, generic feature cards) that doesn't reflect the actual product: Tuya smart meter integration, consumption tracking, limit alerts, and email notifications.

## Current State Analysis

The home page consists of:

- `src/pages/index.astro` — thin wrapper importing Layout + Welcome
- `src/components/Welcome.astro` — hero section with cosmic dark background (animated purple orbs, star field), gradient text "10x Astro Starter", English tagline, Sign In / Sign Up CTAs, and three generic feature cards (Authentication Ready, Modern Stack, Developer Experience) with inline SVG icons
- `src/components/Topbar.astro` — auth-state bar showing email + dashboard link (logged in) or sign in/up links (not logged in), styled with cosmic purple/white colors
- `src/styles/global.css` — defines `@utility bg-cosmic` with `linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)`

The dashboard (`src/pages/dashboard.astro`) also uses `bg-cosmic` and similar gradient text. Both pages share `Layout.astro` which sets `<html lang="en">` and a default title of "10x Astro Starter".

### Key Discoveries:

- The Topbar already reads `Astro.locals.user` for auth-state — same pattern needed for the hero CTA
- The dashboard uses Polish copy throughout (e.g., "Pulpit", "Witaj", "Wyloguj") — the home page should match
- Feature cards currently use inline `<svg>` elements; the project has `lucide-react` installed but since we're staying pure Astro, we'll use inline SVGs from the Lucide icon set (Zap, Gauge, Bell)
- `Layout.astro` has `<html lang="en">` which should become `pl` since both pages are Polish
- The `bg-cosmic` utility in `global.css` is also used by the dashboard — changing it affects both pages, so we introduce a new utility for the home page background rather than modifying `bg-cosmic`

## Desired End State

The home page at `/` shows a clean, energy-themed Polish-language landing page:

- A dark gradient background evoking energy/utility (deep blues/greens instead of space purples)
- A hero section with the product name, Polish tagline explaining what the app does, and auth-aware CTA buttons (Sign In / Sign Up when logged out, "Przejdź do pulpitu" when logged in)
- Three feature cards highlighting: smart meter integration (Tuya), consumption monitoring, and limit alerts with email notifications
- A restyled Topbar matching the energy theme
- A minimal footer with app name and year
- `<html lang="pl">` and a product-specific page title

Verification: navigate to `/` while logged out and see Polish copy, energy theme, sign-in/up CTAs; navigate while logged in and see dashboard CTA instead.

## What We're NOT Doing

- Changing the dashboard page styling or `bg-cosmic` utility (dashboard keeps its current look)
- Adding i18n or English language support
- Converting any component to React (staying pure Astro for zero client-side JS)
- Adding animations, interactive elements, or client:load islands
- Creating a multi-section landing page (no how-it-works, testimonials, etc.)
- Redesigning the auth pages (signin, signup, confirm-email)
- Adding custom illustrations or image assets beyond Lucide icons

## Implementation Approach

Three sequential phases: first the visual foundation (background, colors), then the content (hero copy, feature cards), then the behavioral polish (auth-aware CTA, footer, metadata). Each phase is independently verifiable.

## Phase 1: Visual Theme Update

### Overview

Replace the cosmic/space background and purple accent colors in the home page with an energy-themed palette. Introduce a new CSS utility for the home page background so the dashboard's `bg-cosmic` is untouched.

### Changes Required:

#### 1. New background utility

**File**: `src/styles/global.css`

**Intent**: Add a `bg-energy` utility with a dark blue-to-teal gradient that evokes energy/electricity rather than outer space. Keep `bg-cosmic` unchanged for the dashboard.

**Contract**: New `@utility bg-energy` block adjacent to the existing `@utility bg-cosmic`. Gradient stops should use deep navy (#0a1628) through dark teal (#0d2137) tones.

#### 2. Welcome component background swap

**File**: `src/components/Welcome.astro`

**Intent**: Switch the Welcome component from `bg-cosmic` to `bg-energy`. Remove the cosmic orbs (purple/blue/indigo blurred circles) and star field pattern. Replace with a subtler energy-themed decorative element — a single radial glow in teal/green tones.

**Contract**: The root `<div>` changes class from `bg-cosmic` to `bg-energy`. The three orb `<div>`s and the star field `<div>` are removed. A single decorative glow div replaces them.

#### 3. Topbar color update

**File**: `src/components/Topbar.astro`

**Intent**: Update the Topbar link colors from purple (`text-purple-300`, `hover:text-purple-100`) to teal/emerald tones to match the energy theme.

**Contract**: Replace `text-purple-300` with `text-emerald-300` and `hover:text-purple-100` with `hover:text-emerald-100` on all interactive elements (links, button).

### Success Criteria:

#### Automated Verification:

- TypeScript type check passes: `npx tsc --noEmit` (pre-existing astro:\* errors are acceptable)
- Build succeeds: `npm run build`

#### Manual Verification:

- Home page shows energy-themed dark gradient background, no purple orbs or star field
- Topbar links are teal/emerald, not purple
- Dashboard page at `/dashboard` still uses the original `bg-cosmic` background — no visual regression

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Content and Feature Cards

### Overview

Replace all English placeholder copy with Polish product-specific content. Rewrite the hero heading, tagline, and feature cards to describe the actual energy monitoring product.

### Changes Required:

#### 1. Hero section content

**File**: `src/components/Welcome.astro`

**Intent**: Replace the "10x Astro Starter" heading and English tagline with a Polish product name and description. Update gradient text colors from blue/purple/pink to blue/teal/emerald tones.

**Contract**: The `<h1>` text becomes the product name (e.g., "Monitor Energii"). The `<p>` tagline describes the app in Polish (monitoring consumption, setting limits, getting alerts). Gradient classes shift from `from-blue-200 via-purple-200 to-pink-200` to energy-appropriate tones.

#### 2. Feature cards

**File**: `src/components/Welcome.astro`

**Intent**: Replace the three generic feature cards (Authentication Ready, Modern Stack, Developer Experience) with product-capability cards: (1) smart meter integration via Tuya, (2) real-time consumption tracking, (3) limit alerts with email notifications. Each card gets a relevant Lucide SVG icon (Zap, Gauge, Bell), a Polish title, and a Polish description.

**Contract**: The three card `<div>`s in the `sm:grid-cols-3` grid keep the same structural pattern (border, backdrop-blur, icon + heading + description) but get new inline SVG icons sourced from the Lucide icon set, new headings, and new body text. Icon accent colors shift from `text-purple-300` to `text-emerald-300`.

#### 3. CTA button styling

**File**: `src/components/Welcome.astro`

**Intent**: Update the Sign In / Sign Up button colors from purple to emerald/teal. Translate button labels to Polish ("Zaloguj się", "Zarejestruj się").

**Contract**: The primary CTA changes from `bg-purple-600 hover:bg-purple-500` to `bg-emerald-600 hover:bg-emerald-500`. Button text changes to Polish.

### Success Criteria:

#### Automated Verification:

- TypeScript type check passes: `npx tsc --noEmit`
- Build succeeds: `npm run build`

#### Manual Verification:

- Hero shows Polish product name and tagline with energy-themed gradient text
- Three feature cards describe Tuya integration, consumption monitoring, and alerts — all in Polish
- CTA buttons are emerald/teal and labeled in Polish
- Card layout is responsive (stacked on mobile, 3-column on sm+)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Auth-Aware CTA, Footer, and Metadata

### Overview

Make the hero CTA buttons context-aware (dashboard link when logged in), add a minimal footer, and update page metadata (language, title).

### Changes Required:

#### 1. Auth-aware hero CTA

**File**: `src/components/Welcome.astro`

**Intent**: Read auth state from `Astro.locals.user` (same pattern as Topbar) and conditionally render the hero CTA: when logged in, show a single "Przejdź do pulpitu" button linking to `/dashboard`; when logged out, show the current Sign In / Sign Up pair.

**Contract**: The frontmatter gains `const { user } = Astro.locals;`. The CTA `<div>` wraps in a ternary: `user ? (single dashboard link) : (sign-in + sign-up links)`.

#### 2. Topbar — add app name

**File**: `src/components/Topbar.astro`

**Intent**: Replace the "Not signed in" / email text on the left side of the Topbar with the app name (e.g., "Monitor Energii") as a link to `/`, so the Topbar doubles as a lightweight navbar with branding.

**Contract**: The left-side `<span>` becomes an `<a href="/">` with the app name. The logged-in state still shows the email on the right side next to Dashboard/Sign out links.

#### 3. Minimal footer

**File**: `src/components/Welcome.astro`

**Intent**: Add a simple footer at the bottom of the page with the app name and current year, styled to match the energy theme.

**Contract**: A `<footer>` element after the feature cards grid, inside the z-10 container. Centered text, small/muted styling (`text-sm text-blue-100/40`), containing the app name and year.

#### 4. Layout metadata

**File**: `src/layouts/Layout.astro`

**Intent**: Change `<html lang="en">` to `<html lang="pl">` and update the default title from "10x Astro Starter" to the product name.

**Contract**: The `lang` attribute on `<html>` changes to `"pl"`. The default title in the Props destructuring changes from `"10x Astro Starter"` to the product name.

#### 5. Page title

**File**: `src/pages/index.astro`

**Intent**: Pass a descriptive Polish title to the Layout component for the home page.

**Contract**: The `<Layout>` usage gains a `title` prop with a Polish page title (e.g., "Monitor Energii — Kontroluj zużycie prądu").

### Success Criteria:

#### Automated Verification:

- TypeScript type check passes: `npx tsc --noEmit`
- Build succeeds: `npm run build`
- Existing E2E tests pass: `npx playwright test`

#### Manual Verification:

- When logged out: hero shows "Zaloguj się" / "Zarejestruj się" buttons
- When logged in: hero shows single "Przejdź do pulpitu" button linking to `/dashboard`
- Topbar shows app name on the left as a link to `/`
- Footer visible at bottom with app name and year
- Page title in browser tab is in Polish
- `<html lang="pl">` in page source
- Dashboard page title still shows "Pulpit" (not overwritten)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No unit tests needed — all changes are presentational Astro templates with no business logic.

### Integration Tests:

- Existing E2E tests should continue to pass (auth flows navigate through the home page)

### Manual Testing Steps:

1. Open `/` while logged out — verify Polish copy, energy theme, sign-in/up CTAs
2. Open `/` while logged in — verify "Przejdź do pulpitu" CTA, Topbar shows email + dashboard link
3. Open `/dashboard` — verify it still uses cosmic theme, no visual regression
4. Check responsive layout on mobile viewport (feature cards stack, hero text scales)
5. Verify page source has `<html lang="pl">` and correct `<title>`
6. Click through Sign In / Sign Up / Dashboard CTAs to verify links work

## Performance Considerations

- Zero client-side JS on the home page (pure Astro, no React islands)
- Removing the three cosmic orb divs and star field div reduces DOM size
- No new assets or images — only inline SVG icons from Lucide

## References

- Current home page: `src/pages/index.astro`, `src/components/Welcome.astro`
- Dashboard for pattern reference: `src/pages/dashboard.astro`
- Theme system: `src/styles/global.css`
- Layout: `src/layouts/Layout.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Visual Theme Update

#### Automated

- [x] 1.1 TypeScript type check passes
- [x] 1.2 Build succeeds

#### Manual

- [x] 1.3 Home page shows energy-themed background, no cosmic orbs
- [x] 1.4 Topbar links are teal/emerald
- [x] 1.5 Dashboard retains original bg-cosmic — no regression

### Phase 2: Content and Feature Cards

#### Automated

- [ ] 2.1 TypeScript type check passes
- [ ] 2.2 Build succeeds

#### Manual

- [ ] 2.3 Hero shows Polish product name and tagline
- [ ] 2.4 Feature cards describe product capabilities in Polish
- [ ] 2.5 CTA buttons are emerald and labeled in Polish
- [ ] 2.6 Responsive layout works on mobile

### Phase 3: Auth-Aware CTA, Footer, and Metadata

#### Automated

- [ ] 3.1 TypeScript type check passes
- [ ] 3.2 Build succeeds
- [ ] 3.3 Existing E2E tests pass

#### Manual

- [ ] 3.4 Logged-out state shows sign-in/up buttons
- [ ] 3.5 Logged-in state shows dashboard CTA
- [ ] 3.6 Topbar shows app name as link
- [ ] 3.7 Footer visible with app name and year
- [ ] 3.8 Page title and lang attribute are Polish
- [ ] 3.9 Dashboard page unaffected
