# @platform/mobile

The mobile app — **Expo (SDK 54) + Expo Router + TypeScript**, inside the
Turborepo/pnpm monorepo. It shares the same packages as the web app
(`@platform/core`, `@platform/auth`, `@platform/db`, `@platform/i18n`) instead of
duplicating them.

## Status — STEP 2 (login + session persistence)

Email/password **login** using the same `@platform/auth` `signIn` as web. The
RN Supabase client (via `@platform/db`'s native factory) persists the session in
**AsyncStorage** with `autoRefreshToken`, so the user stays logged in across app
restarts. Screens (Expo Router):

- `app/index.tsx` — entry gate: reads the persisted session and redirects to
  `/home` (logged in) or `/landing`. Shows a spinner during the read, never gates
  on the splash.
- `app/landing.tsx` — logged-out landing, **parity with web**: language + theme
  switchers, hero + CTA, scrollable explainer sections (what this is /
  architecture / security / why), and a gated demo-logins section.
- `app/login.tsx` — email + password form, button loading state, friendly error.
- `app/home.tsx` — authenticated screen showing the user's email and their
  organization(s) + role(s) (membership resolution via `getUserOrganizations`,
  same as the web dashboard), with switchers and a logout button.

**App-wide context** (in `app/_layout.tsx`) so every screen inherits the choices:

- `lib/theme-context.tsx` — light/dark theme driven by the shared `themes` tokens
  from `@platform/config` (single source of truth); persisted to AsyncStorage.
- `lib/locale-context.tsx` — he/en locale with RTL/LTR direction; persisted to
  AsyncStorage. Strings come from `@platform/i18n` (the `landing` namespace is
  shared with web — no duplicated copy). Defaults to Hebrew (RTL) like web.
- `components/language-switcher.tsx`, `components/theme-toggle.tsx` — reusable.

No dashboard/chat/members screens yet — those come in later steps.

## Environment

Expo only exposes variables prefixed with `EXPO_PUBLIC_` to the client bundle
(the equivalent of the web's `NEXT_PUBLIC_`). Copy the example and fill it in:

```bash
cp .env.example .env.local
```

Required (public, low-privilege values only):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

**Never** put the Supabase secret/service-role key in the mobile app — it is a
client, same rule as the web app.

## Run it (Expo Go — no simulator needed)

1. Install **Expo Go** on your phone (iOS App Store / Google Play).
2. From the repo root, start the bundler:
   ```bash
   pnpm --filter @platform/mobile start
   ```
3. A QR code prints in the terminal. Scan it:
   - **iOS:** the Camera app → tap the banner.
   - **Android:** scan from inside the Expo Go app.
4. The app loads over your network — your phone and computer must be on the
   **same Wi-Fi**. If they can't connect, restart with a tunnel:
   ```bash
   pnpm --filter @platform/mobile start -- --tunnel
   ```

(Alternatives, if you later set them up: press `a` for an Android emulator or
`i` for an iOS simulator in the same terminal.)

## Monorepo notes

`metro.config.js` watches the repo root and resolves modules from the app then
the workspace root — the standard Expo monorepo setup. The shared packages are
React-free TypeScript consumed directly from source, so Metro transpiles them
along with the app.
