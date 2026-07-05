# dashboard (web)

The dashboard's view layer, restyled with the Home-shell design (token-driven
airy cards, geometric glyphs, coming-soon treatment, responsive dock/rail).
Renders `DASHBOARD_CARDS` filtered by server-resolved capabilities (same
ownerOnly / requiredPermission semantics as `@platform/core` FEATURES, plus the
old nav's org-membership rule). Real cards (chat, members, platform) navigate
to the existing screens — each screen still enforces its own access; card
visibility is UX only. Schedule/tasks are "coming soon" placeholders. Logout
uses the existing server action. No DB tables, no dedicated permission.
