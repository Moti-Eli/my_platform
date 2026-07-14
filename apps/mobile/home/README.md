# home (mobile)

Design shell for the Home screen — top bar, date strip, capability-filtered
"coming soon" cards, presentational tab bar. Cards are gated by the local
`HOME_CARDS` registry (same ownerOnly / requiredPermission semantics as
`@platform/core` FEATURES); filtering is UI convenience only — no destinations
exist yet, so there is nothing to guard. No DB tables, no dedicated permission.
Real bits: the avatar signs out (confirm → `@platform/auth` signOut → landing),
and the menu opens a provisional drawer linking to the existing members / chat /
platform screens (gated as those screens already are) until tabs are wired.
