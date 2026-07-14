/**
 * Cortex wordmark glyph — a simple "brain + circuit" placeholder mark. Uses the
 * design-system colors via currentColor / token utilities on the wrapper, so it
 * re-themes with the tokens. Swap for the final brand mark later.
 */
import type { SVGProps } from "react";

export function BrainLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      focusable={false}
      {...props}
    >
      {/* brain lobe */}
      <path
        d="M20 6.5c3.2 0 5.5 2.3 5.5 5.2 0 1 .4 1.6 1 2.4.8 1 .9 2.6 0 3.7-.5.6-.7 1-.7 1.8 0 2.7-2.2 4.4-5 4.4-1.3 0-2.4-.5-3.2-1.3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.5C8.8 6.5 6.5 8.8 6.5 11.7c0 1-.4 1.6-1 2.4-.8 1-.9 2.6 0 3.7.5.6.7 1 .7 1.8 0 2.7 2.2 4.4 5 4.4 1.3 0 2.4-.5 3.2-1.3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 7v18"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.5}
      />
      {/* circuit nodes */}
      <circle cx="16" cy="12" r="1.6" fill="currentColor" />
      <circle cx="16" cy="20" r="1.6" fill="currentColor" />
    </svg>
  );
}
