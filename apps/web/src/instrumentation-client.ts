import { logger } from "@platform/observability";

/**
 * Browser instrumentation. Activates the Sentry CLIENT adapter ONLY when
 * `NEXT_PUBLIC_SENTRY_DSN` is set. Because that var is statically inlined at
 * build time, when it's unset this whole branch (and the Sentry import) is
 * tree-shaken out of the client bundle entirely.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("./lib/observability/sentry.client").then((m) => m.registerSentryClient());
} else {
  logger.debug("observability: console mode (client)");
}
