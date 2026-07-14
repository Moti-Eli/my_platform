# @platform/cortex

The **Cortex super-app shell** — the visual frame that hosts tools. A phone-first
Next.js (App Router) app, RTL Hebrew, installable as a **PWA**. This milestone is
the **frame only**: no real sub-apps, no AI model calls. Home and Profile are
empty shells; the AI button and urgency bell are empty shells too.

Additive and isolated — it does **not** touch `apps/web` or `apps/mobile`.

## Layout

- **Phone-first**, centered on desktop (`max-w-[480px]` column).
- **Header** (`src/components/shell/Header.tsx`): brain+tech logo, a stub search
  button, and the urgency **bell** (opens the "מה דחוף היום" inbox — empty).
- **Bottom tab bar** (`src/components/shell/TabBar.tsx`) — 5 slots, RTL order:
  Home (right-most) · כל הכלים (catalog) · **AI hero** (center) · צ'אט (comms) ·
  Profile (left-most). The AI hero is a larger, elevated button that opens the
  **AI sheet** (`AiSheet.tsx`, empty shell — input + placeholder, no model call).
- **Screens**: Home (`app/page.tsx`, app-tabs placeholder + "nothing pinned"),
  Catalog, Comms, Profile (Identity Core placeholder) — all `app/**/page.tsx`.

## Design system

Colors/radii/shadows/font live in **`@/design-system`** (`src/design-system/`)
as the single source of truth. `tokenStylesheet()` emits them as `:root` CSS
variables; `globals.css` maps Tailwind utilities onto those via `@theme inline`.
Components use utilities (`bg-indigo`, `text-ink`, `rounded-xl`, `shadow-soft`)
— **no hard-coded colors**. Palette: indigo `#5B4CE0`, teal `#12A08E`, coral
`#F5744F`, amber `#DE982B`, ink `#221E31`, screen `#F7F6FB`.

## Run it

```bash
pnpm --filter @platform/cortex dev      # http://localhost:3001  (binds 0.0.0.0)
```

The dev server binds to `0.0.0.0`, so it's reachable from your phone on the same
Wi-Fi at `http://<YOUR-COMPUTER-LAN-IP>:3001`.

### Install on your phone ("Add to Home Screen")

1. Find your computer's LAN IP (Windows: `ipconfig` → IPv4, e.g. `192.168.1.23`).
2. Phone on the **same Wi-Fi** → open `http://192.168.1.23:3001` in the browser.
3. **iOS Safari**: Share → *Add to Home Screen*. **Android Chrome**: ⋮ menu →
   *Add to Home screen* / *Install app*. It launches standalone (no browser
   chrome) thanks to the manifest.
4. **Offline caching** (the service worker) requires a **secure context** —
   `localhost` or **https**. Over a plain-http LAN IP the SW intentionally
   no-ops (the app still installs and loads). For full offline on a phone, serve
   over https, e.g. a quick tunnel:

   ```bash
   npx cloudflared tunnel --url http://localhost:3001   # prints an https URL
   ```

   Open that https URL on the phone and install — the SW then caches the shell.

## PWA files

- `public/manifest.webmanifest` — name, theme/background colors (from palette),
  RTL/he, standalone, icon.
- `public/sw.js` — hand-rolled service worker (network-first navigations,
  cache-first assets; app-shell precache).
- `public/icons/icon.svg` — **placeholder** maskable icon. Swap for final
  PNG art (192/512, and a 180×180 apple-touch-icon) before production.

## Scope (this prompt)

No DB tables/migrations, no real tools, no AI/model calls, no auth. The AI sheet
`handleSubmit` is a stub that a later prompt wires to `@platform/cortex-core`'s
`runIntent`.
