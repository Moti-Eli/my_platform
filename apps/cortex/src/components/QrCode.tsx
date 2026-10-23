/**
 * A QR code as an inline SVG — a SERVER component (no client JS). The matrix
 * comes from the `qrcode` library; the modules are drawn in `currentColor` on the
 * theme-independent code tokens (`text-code-ink` on `bg-code-paper`), so the code
 * stays dark-on-light — scannable — in every theme, with no hard-coded colour.
 */
import QRCode from "qrcode";

/** Quiet zone around the code, in modules (the spec asks for 4). */
const QUIET_ZONE = 4;

export function QrCode({ value, label }: { value: string; label: string }) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // get(row, col): row = y, col = x.
      if (modules.get(y, x)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  const box = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      className="h-48 w-48 rounded-md bg-code-paper text-code-ink"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
