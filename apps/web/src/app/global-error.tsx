"use client";

import { useEffect } from "react";
import { captureException } from "@platform/observability";

/**
 * Root (global) error boundary — catches errors in the root layout itself. It
 * REPLACES the root layout, so the app's CSS/tokens aren't guaranteed to be
 * present; we use minimal inline styles. Reports through our observability
 * abstraction (never a vendor SDK directly).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: "global", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <main style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, margin: "0 0 1.5rem" }}>
            An unexpected error occurred. You can try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: "0.5rem",
              border: "none",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              background: "#fafafa",
              color: "#0a0a0a",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
