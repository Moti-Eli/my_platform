# @platform/mobile

The mobile app — **Expo (SDK 54) + Expo Router + TypeScript**, inside the
Turborepo/pnpm monorepo. It shares the same packages as the web app
(`@platform/core`, `@platform/auth`, `@platform/db`, `@platform/i18n`) instead of
duplicating them.

## Status — STEP 1 (skeleton only)

One screen (`app/index.tsx`): a **Supabase health check**. It creates an
anonymous Supabase client via the shared `@platform/db` and lists the global
permission keys via `@platform/auth`. This proves the app runs, the shared
packages resolve through Metro, and the device reaches Supabase. No login,
navigation, or real screens yet.

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
