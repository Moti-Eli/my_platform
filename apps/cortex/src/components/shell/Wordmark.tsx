/**
 * The "cortex" wordmark — a styled-text placeholder for a future SVG logo.
 *
 * Extracted from {@link Header} so the shell header and the bare auth screens
 * render the SAME element rather than two copies that drift apart. It is the one
 * place the brand font stack lives.
 *
 * Kept `dir="ltr"` — latin letters, even inside the RTL layout. There is no
 * brand/display font token in the design-system, so the cursive fallback stack
 * below is the one non-token value here, by design (it moved with the element;
 * it is not new).
 *
 * `className` carries the CONTEXT's layout only — the header passes
 * `flex-1 text-center` for its three-zone row; the auth layout passes nothing.
 * Colour and type role are the element's own and are not overridable.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      dir="ltr"
      className={`type-display text-accent${className ? ` ${className}` : ""}`}
      style={{ fontFamily: '"Segoe Script", "Bradley Hand", "Brush Script MT", cursive' }}
    >
      cortex
    </span>
  );
}
