/**
 * Geometric SVG glyphs — the same minimal visual language as the mobile shell
 * (dots / bars / rings / diamond + tab marks). All strokes/fills inherit
 * `currentColor`, so color always comes from token-driven classes or styles.
 */
export type GlyphName =
  | "dots"
  | "bars"
  | "rings"
  | "diamond"
  | "home"
  | "chat"
  | "profile"
  | "menu"
  | "arrow";

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  const common = {
    viewBox: "0 0 20 20",
    className,
    "aria-hidden": true as const,
    fill: "currentColor",
  };

  switch (name) {
    case "dots":
      return (
        <svg {...common}>
          <circle cx="6.2" cy="6.2" r="2.6" />
          <circle cx="13.8" cy="6.2" r="2.6" />
          <circle cx="6.2" cy="13.8" r="2.6" />
          <circle cx="13.8" cy="13.8" r="2.6" opacity="0.45" />
        </svg>
      );
    case "bars":
      return (
        <svg {...common}>
          <rect x="3" y="3.6" width="14" height="2.7" rx="1.35" />
          <rect x="3" y="8.65" width="9.5" height="2.7" rx="1.35" />
          <rect x="3" y="13.7" width="12" height="2.7" rx="1.35" opacity="0.45" />
        </svg>
      );
    case "rings":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="10" cy="10" r="2.4" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <rect x="4.8" y="4.8" width="10.4" height="10.4" rx="2.4" transform="rotate(45 10 10)" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <rect
            x="3.2"
            y="3.2"
            width="13.6"
            height="13.6"
            rx="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <rect x="8.7" y="10.6" width="2.6" height="4" rx="1.3" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path
            d="M10 3.2c-3.9 0-7 2.7-7 6.1 0 1.9 1 3.6 2.5 4.7l-.6 2.8 3.1-1.5c.6.1 1.3.2 2 .2 3.9 0 7-2.7 7-6.2s-3.1-6.1-7-6.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <circle cx="7.6" cy="9.4" r="1.25" />
          <circle cx="12.4" cy="9.4" r="1.25" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="10" cy="6.4" r="3.4" />
          <path d="M3.6 17.2c0-3 2.9-5 6.4-5s6.4 2 6.4 5" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <rect x="3" y="4.6" width="14" height="2.4" rx="1.2" />
          <rect x="3" y="8.8" width="10" height="2.4" rx="1.2" />
          <rect x="3" y="13" width="14" height="2.4" rx="1.2" />
        </svg>
      );
    case "arrow":
      // Points inline-end; callers flip it in RTL with `rtl:-scale-x-100`.
      return (
        <svg {...common}>
          <path
            d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
