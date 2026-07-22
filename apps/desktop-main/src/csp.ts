/**
 * Renderer Content-Security-Policy (§12.3). Extracted from the Electron entry
 * so the exact directives are unit-pinned — widening any of them must fail a
 * test, not slip through a refactor.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: artifact:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "media-src 'self' artifact:",
  // PDF.js fetches immutable, capability-tokened artifact snapshots. The
  // protocol host never exposes arbitrary filesystem paths.
  "connect-src 'self' artifact:",
  "object-src 'none'",
  // ADR-0022: the acceptance-gate preview iframes the task's OWN dev server —
  // loopback http only. Every other directive is unchanged; widening this
  // further must fail the pin test.
  'frame-src artifact: http://localhost:* http://127.0.0.1:*',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Dev-server-only CSP: vite's @vitejs/plugin-react injects an inline
 * react-refresh preamble and HMR talks over a websocket — both are blocked by
 * the production policy (blank window). Applies exclusively to requests from
 * the localhost dev server; the packaged app:// surface always gets CSP above.
 */
export const DEV_CSP = CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace("connect-src 'self' artifact:", "connect-src 'self' artifact: ws:");
