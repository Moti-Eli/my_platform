/**
 * In-app navigation counter — the guard that keeps router.back() from ejecting
 * the user out of the app.
 *
 * `router.back()` with no in-app history (a deep link, a PWA cold start on an
 * inner screen, landing there via the login redirect) leaves the app entirely.
 * The shell calls {@link markNavigation} on every pathname change, and back
 * controls consult {@link canGoBackInApp} before calling router.back(),
 * falling back to router.push("/") when there is nowhere in-app to go.
 *
 * MODULE STATE, ON PURPOSE: the counter resets on every full page load, which
 * is exactly the semantics we want — a cold start has no in-app history, no
 * matter what the browser's own history stack claims. And it is deliberately
 * NOT reactive (no React, no state, no hooks): both consumers read it inside a
 * click handler, never during render, so nothing needs to re-render when it
 * changes.
 */

/** How many in-app navigations this page load has recorded. */
let navigations = 0;

/** Record one in-app navigation (called by the shell on every pathname change). */
export function markNavigation(): void {
  navigations += 1;
}

/** Whether router.back() would land on another IN-APP screen. The first
 * recorded navigation is the initial route itself, so "more than one" is the
 * threshold — before a second screen has been visited there is nothing in-app
 * to go back to. */
export function canGoBackInApp(): boolean {
  return navigations > 1;
}
