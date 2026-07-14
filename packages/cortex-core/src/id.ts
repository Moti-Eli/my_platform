/**
 * ID generation that works in NON-secure contexts.
 *
 * `crypto.randomUUID()` (and `crypto.subtle`) are only defined in *secure
 * contexts* — https, or http on `localhost`. Over a bare IP on plain http, e.g.
 * a phone hitting `http://10.0.0.3:3001`, `crypto.randomUUID` is `undefined`, so
 * calling it throws — which previously broke registry/runtime init silently.
 *
 * {@link safeRandomUUID} NEVER throws. It prefers the native `randomUUID()`,
 * falls back to a `getRandomValues`-based RFC-4122 v4 UUID (getRandomValues is
 * available in non-secure contexts), and finally to a `Math.random` v4 if no
 * Web Crypto is present at all (not cryptographically strong, but our ids only
 * need to be unique, not unguessable).
 */
/** The slice of the Web Crypto API we use, typed structurally so this helper is
 * independent of each package's `lib` config (DOM vs node). */
type MaybeCrypto = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

export function safeRandomUUID(): string {
  const webCrypto = (globalThis as { crypto?: MaybeCrypto }).crypto;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set the version (4) and variant (10xx) bits per RFC 4122 §4.4.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
