import { captureException, logger } from "@platform/observability";

/**
 * Next.js server instrumentation. Activates the Sentry SERVER adapter ONLY when
 * `SENTRY_DSN` is set; otherwise the app stays in structured-console mode. The
 * Sentry SDK is dynamically imported so it isn't even loaded when unused.
 */
export async function register(): Promise<void> {
  if (process.env.SENTRY_DSN) {
    const { registerSentryServer } = await import("./lib/observability/sentry.server");
    registerSentryServer();
  } else {
    logger.info("observability: console mode (SENTRY_DSN not set)");
  }
}

/**
 * Next.js invokes this for errors thrown while handling a request (server
 * components, route handlers, server actions). We route them through our
 * abstraction (structured log + active reporter). We log only non-sensitive
 * request metadata — NEVER headers, which carry auth cookies/tokens.
 */
export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string }
): void {
  captureException(error, {
    source: "onRequestError",
    method: request?.method,
    routerKind: context?.routerKind,
    routePath: context?.routePath,
    routeType: context?.routeType,
  });
}
