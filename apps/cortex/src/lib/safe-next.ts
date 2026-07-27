/**
 * Sanitise a post-auth `next` destination to a SAME-ORIGIN RELATIVE PATH.
 *
 * Shared by /confirm and /set-password so every hop in the recovery chain
 * (confirm → set-password → the tool) applies the IDENTICAL rule. A value is
 * accepted only when it is a single-leading-slash relative path; a QUERY STRING is
 * allowed (e.g. "/set-password?next=/tools/questionnaire") — only the target
 * ORIGIN is constrained, never the presence of a query. Rejected (→ fallback):
 * anything not starting with "/", protocol-relative "//host", and backslash-tricked
 * "/\\host" — the classic open-redirect shapes a browser reads as off-site.
 *
 * Never trust a `next` from the URL (confirm) OR from a form field (set-password):
 * both are attacker-controllable, so both sanitise through here before redirecting.
 */
export function safeRelativePath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  return raw;
}
