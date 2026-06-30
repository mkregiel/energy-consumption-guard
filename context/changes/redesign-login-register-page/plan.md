# Redesign Login & Register Pages — Implementation Plan

## Overview

Redesign the auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) from minimal centered cards with `bg-cosmic` / purple accents to a split-panel layout reusing the homepage's `bg-energy` / teal-emerald visual language, with all copy translated to Polish.

## Current State Analysis

The auth pages use a different visual theme than the recently redesigned homepage:

- **Homepage** (`Welcome.astro`): `bg-energy` background, radial teal glow, `from-blue-200 via-teal-200 to-emerald-200` gradient heading, emerald-600 CTAs, `border-white/10 bg-white/5 backdrop-blur-xl` cards.
- **Auth pages** (`signin.astro`, `signup.astro`, `confirm-email.astro`): `bg-cosmic` background, `from-blue-200 to-purple-200` gradient heading, purple-600 buttons, purple-400 focus rings, purple-300 links.
- **Form components** (`FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx`): Hardcoded purple accent classes (`focus:ring-purple-400`, `bg-purple-600`). These need to switch to emerald.
- **Copy**: All auth UI is in English while the homepage is Polish.

### Key Discoveries:

- `bg-cosmic` and `bg-energy` are custom Tailwind utilities defined in `src/styles/global.css:113-119`
- `FormField.tsx:53` hardcodes `focus:ring-purple-400` — needs to become emerald
- `SubmitButton.tsx:18` hardcodes `bg-purple-600 hover:bg-purple-500` — needs to become emerald
- The `FormField` component accepts an `icon` and `endContent` slot — no structural changes needed
- `SubmitButton` uses `useFormStatus` from react-dom — logic stays the same
- Homepage branded panel content can be lifted from `Welcome.astro:57-124` (feature cards with inline SVG icons)
- Lesson from `lessons.md`: E2E tests on auth pages need `waitForLoadState("networkidle")` before form interaction due to Astro `client:load` hydration

## Desired End State

All three auth pages share a consistent split-panel layout: form on the left, branded "Monitor Energii" panel with feature highlights on the right (stacking vertically on mobile). The visual theme matches the homepage — `bg-energy` background, teal glow, emerald accents. All user-facing text is in Polish.

**Verification**: Navigate to `/auth/signin`, `/auth/signup`, and `/auth/confirm-email` — each should show the split layout with the energy theme, Polish copy, and responsive collapse on mobile viewports.

## What We're NOT Doing

- Changing auth logic, API endpoints, or Supabase integration
- Adding OAuth/social login providers
- Changing the `confirm-email` dev vs prod content branching logic
- Adding i18n infrastructure — this is a one-off Polish translation of hardcoded strings
- Modifying middleware or route protection
- Changing the `FormField`, `PasswordToggle`, or `ServerError` component APIs (only their accent color classes)

## Implementation Approach

Create a new `AuthLayout.astro` component that wraps the split-panel structure and branded side panel, then migrate each auth page to use it. Update form component accent colors from purple to emerald. Translate all auth strings to Polish in one pass.

## Phase 1: Auth layout with split-panel and homepage theme

### Overview

Create the shared `AuthLayout.astro` component with the `bg-energy` background, teal radial glow, split-panel structure, and branded side panel. Update form component accent colors from purple to emerald.

### Changes Required:

#### 1. Auth layout component

**File**: `src/components/auth/AuthLayout.astro` (new)

**Intent**: Create a reusable Astro layout component that provides the split-panel auth page structure. Left side renders a named slot for the form content. Right side shows the "Monitor Energii" branded panel with feature highlights (reusing homepage copy and feature card pattern from `Welcome.astro`). On mobile (`< lg`), the branded panel either hides or stacks above the form.

**Contract**: Accepts a `title` prop (string) for the page `<title>`. Renders a default slot for the form panel content. Uses `bg-energy` background with the same radial teal glow as `Welcome.astro:10-12`. The branded panel reuses the heading gradient `from-blue-200 via-teal-200 to-emerald-200` and 2-3 feature highlights with emerald-300 icons. Wraps content in `Layout.astro` for the HTML shell.

#### 2. Form field accent color

**File**: `src/components/auth/FormField.tsx`

**Intent**: Switch the focus ring accent from purple to emerald to match the homepage theme.

**Contract**: Line 53 — change `focus:ring-purple-400` to `focus:ring-emerald-400`.

#### 3. Submit button accent color

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Switch the button background from purple to emerald to match the homepage CTAs.

**Contract**: Line 18 — change `bg-purple-600 hover:bg-purple-500` to `bg-emerald-600 hover:bg-emerald-500`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (pre-existing Astro virtual module errors excepted)
- Linting passes: `npx prettier --check "src/components/auth/**"`
- New `AuthLayout.astro` file exists at `src/components/auth/AuthLayout.astro`

#### Manual Verification:

- Auth layout renders correctly at desktop (≥1024px): form on left, branded panel on right
- Auth layout renders correctly on mobile (<1024px): form visible, branded panel collapses/stacks
- Branded panel shows "Monitor Energii" heading, tagline, and 2-3 feature highlights
- Emerald accent colors visible on buttons and form focus states
- Energy background and teal glow match the homepage visual

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Polish copy & page migration

### Overview

Translate all auth form strings to Polish and migrate all three auth pages to use the new `AuthLayout.astro` component.

### Changes Required:

#### 1. Sign-in form Polish copy

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Translate all user-facing strings to Polish — labels, placeholders, validation messages, and button text.

**Contract**: String mapping:

- "Email" → "E-mail"
- "you@example.com" → "ty@example.com"
- "Email is required" → "E-mail jest wymagany"
- "Enter a valid email address" → "Podaj prawidłowy adres e-mail"
- "Password" → "Hasło"
- "Your password" → "Twoje hasło"
- "Password is required" → "Hasło jest wymagane"
- "Signing in..." → "Logowanie..."
- "Sign in" → "Zaloguj się"

#### 2. Sign-up form Polish copy

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Translate all user-facing strings to Polish — labels, placeholders, validation messages, password hint, and button text.

**Contract**: String mapping:

- "Email" → "E-mail"
- "you@example.com" → "ty@example.com"
- "Email is required" → "E-mail jest wymagany"
- "Enter a valid email address" → "Podaj prawidłowy adres e-mail"
- "Password" → "Hasło"
- "Min. 6 characters" → "Min. 6 znaków"
- "Password is required" → "Hasło jest wymagane"
- "Password must be at least N characters" → "Hasło musi mieć co najmniej N znaków"
- "more character(s) needed" → "jeszcze N znak(ów)"
- "Confirm password" → "Potwierdź hasło"
- "Re-enter your password" → "Wpisz ponownie hasło"
- "Please confirm your password" → "Potwierdź swoje hasło"
- "Passwords do not match" → "Hasła nie są takie same"
- "Creating account..." → "Tworzenie konta..."
- "Create account" → "Utwórz konto"

#### 3. Sign-in page migration

**File**: `src/pages/auth/signin.astro`

**Intent**: Replace the inline card layout with `AuthLayout.astro`. Translate the heading and footer link text to Polish.

**Contract**: Uses `AuthLayout` instead of raw `Layout` + inline card markup. Heading becomes "Zaloguj się". Footer link: "Nie masz konta?" with link text "Zarejestruj się" pointing to `/auth/signup`.

#### 4. Sign-up page migration

**File**: `src/pages/auth/signup.astro`

**Intent**: Replace the inline card layout with `AuthLayout.astro`. Translate the heading and footer link text to Polish.

**Contract**: Uses `AuthLayout` instead of raw `Layout` + inline card markup. Heading becomes "Zarejestruj się". Footer link: "Masz już konto?" with link text "Zaloguj się" pointing to `/auth/signin`.

#### 5. Confirm-email page migration

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Replace the inline card layout with `AuthLayout.astro`. Translate both dev and prod content variants to Polish.

**Contract**: Uses `AuthLayout` instead of raw `Layout` + inline card markup. Polish content:

- Dev: heading "Rejestracja zakończona", description "Twoje konto zostało utworzone. Możesz się teraz zalogować.", link "Przejdź do logowania"
- Prod: heading "Sprawdź swoją skrzynkę", description "Wysłaliśmy link potwierdzający na Twój adres e-mail. Kliknij go, aby aktywować konto.", link "Wróć do logowania"

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (pre-existing Astro virtual module errors excepted)
- Linting passes: `npx prettier --check "src/pages/auth/** src/components/auth/**"`
- All three auth pages import `AuthLayout` (not raw `Layout`)

#### Manual Verification:

- `/auth/signin` shows split-panel layout with Polish form labels, placeholders, and validation messages
- `/auth/signup` shows split-panel layout with Polish form labels, password hint, and validation messages
- `/auth/confirm-email` shows Polish content in both dev and prod modes
- Navigation links between signin ↔ signup work correctly
- Form submission still works end-to-end (signin and signup flows)
- Server error messages display correctly when returned from API
- Responsive layout works on mobile for all three pages

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new unit tests required — existing auth-guard and middleware tests are unaffected (this is a visual-only change)

### Integration Tests:

- Existing `auth-boundary.test.ts` should continue passing (API endpoints unchanged)

### Manual Testing Steps:

1. Navigate to `/auth/signin` — verify split-panel layout, emerald accents, Polish copy, form validation in Polish
2. Navigate to `/auth/signup` — verify split-panel, password strength hint in Polish, confirm-password validation in Polish
3. Submit invalid signin — verify Polish validation errors and server error display
4. Submit valid signup — verify redirect to `/auth/confirm-email` with Polish content
5. Resize browser to mobile width — verify branded panel collapses, form remains usable
6. Navigate between signin ↔ signup via footer links — verify links work and layout is consistent
7. Visit homepage → click "Zaloguj się" CTA → verify visual continuity between homepage and auth page

## Performance Considerations

No performance impact. The branded panel reuses static content (SVG icons, text). No additional network requests, no new JS bundles — `AuthLayout.astro` is server-rendered.

## References

- Homepage visual reference: `src/components/Welcome.astro`
- Current auth pages: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`
- Form components: `src/components/auth/FormField.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/ServerError.tsx`
- Custom backgrounds: `src/styles/global.css:113-119` (`bg-cosmic`, `bg-energy`)
- Lesson: E2E tests on auth pages need `waitForLoadState("networkidle")` — `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth layout with split-panel and homepage theme

#### Automated

- [x] 1.1 Type checking passes — 39da281
- [x] 1.2 Linting passes — 39da281
- [x] 1.3 AuthLayout.astro file exists — 39da281

#### Manual

- [x] 1.4 Desktop split-panel renders correctly — 39da281
- [x] 1.5 Mobile responsive collapse works — 39da281
- [x] 1.6 Branded panel content matches homepage theme — 39da281
- [x] 1.7 Emerald accent colors on buttons and focus states — 39da281

### Phase 2: Polish copy & page migration

#### Automated

- [x] 2.1 Type checking passes
- [x] 2.2 Linting passes
- [x] 2.3 All auth pages import AuthLayout

#### Manual

- [x] 2.4 Signin page shows Polish copy and split-panel layout
- [x] 2.5 Signup page shows Polish copy and split-panel layout
- [x] 2.6 Confirm-email page shows Polish content (dev + prod)
- [x] 2.7 Signin ↔ signup navigation links work
- [x] 2.8 Form submission works end-to-end
- [x] 2.9 Server error messages display correctly
- [x] 2.10 Responsive layout works on mobile for all three pages
