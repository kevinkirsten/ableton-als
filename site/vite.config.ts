import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"

// The demo is built from the source tree, never from npm: it imports
// `../src/web.ts` directly, so the page and the library cannot drift apart.

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string }

/**
 * The Content Security Policy is the privacy guarantee, stated in a form a
 * sceptical visitor can check: with `connect-src 'none'` the page is
 * structurally unable to send a file anywhere. No fetch, no XHR, no WebSocket,
 * no beacon.
 *
 * Injected at build time only. The dev server needs a WebSocket for reloads,
 * which is exactly what this policy forbids.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", // anything not listed below is refused
  "script-src 'self'", // the page's own modules, no inline script
  "worker-src 'self'", // the Web Worker that does all the work
  "style-src 'self'", // the page's own stylesheet, no inline styles
  "font-src 'self'", // fonts are served from this origin, no CDN
  "img-src 'self' data:",
  "connect-src 'none'", // THE guarantee: no network requests from script
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ")

function contentSecurityPolicy(): Plugin {
  return {
    name: "demo-content-security-policy",
    apply: "build",
    // A plain string replacement rather than a tag descriptor, so the quotes
    // reach the page unescaped: a visitor reading the source should see
    // `connect-src 'none'` exactly as written here.
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      if (!html.includes(CSP_PLACEHOLDER)) {
        throw new Error("index.html lost its Content-Security-Policy placeholder")
      }
      return html.replace(CSP_PLACEHOLDER, tag)
    },
  }
}

const CSP_PLACEHOLDER = "<!-- content-security-policy -->"

export default defineConfig({
  // Relative, so the same build works under /ableton-als/ on GitHub Pages and
  // at the root of a local preview.
  base: "./",
  plugins: [contentSecurityPolicy()],
  define: {
    __LIB_VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? "local").slice(0, 7)),
  },
  server: { port: 3140, strictPort: true, host: "127.0.0.1" },
  preview: { port: 3141, strictPort: true, host: "127.0.0.1" },
  worker: { format: "es" },
  // The sample set is bundled as bytes (`?inline`), because the page may not
  // fetch anything. Vite only does that for file types it knows are assets.
  assetsInclude: ["**/*.als"],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    // The preload polyfill uses fetch, which the policy above forbids, and
    // inlined assets would need `data:` in font-src.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
})
