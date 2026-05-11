/* HPA Growth Assessments — Service Worker
 *
 * Strategy:
 *   - Cache the app shell (build assets + manifest + icons + fonts) so the
 *     app boots instantly on Chromebooks and survives flaky network.
 *   - NEVER cache Supabase API / RPC requests — student answers and roster
 *     data must always hit the network. (FERPA + correctness.)
 *   - Update strategy: SILENT — new SW installs in the background and
 *     activates on the next browser launch (no skipWaiting). This is the
 *     safest behavior for kiosk-mode testing — mid-test reloads never happen.
 *
 * Bump CACHE_VERSION whenever you ship a new build that changes static
 * file paths (CRA hashes most filenames already, so this is mostly for
 * the index.html itself + manifest).
 */
const CACHE_VERSION = "hpa-v3";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.ico",
  "/logo192.png",
  "/logo512.png",
  "/logo512-maskable.png",
  "/apple-touch-icon.png",
];

// --- install: pre-cache the shell ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll is atomic — if any fails, nothing is cached. allSettled is
      // friendlier: if /apple-touch-icon.png is missing, we don't crash.
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)))
    )
  );
  // Do NOT call self.skipWaiting() — silent update behavior.
});

// --- activate: prune old caches ---
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// --- helpers ---
function isApiRequest(url) {
  // Anything we MUST never cache:
  //   - Supabase REST / RPC / Auth / Storage
  //   - Microsoft Entra ID OAuth callbacks
  //   - Anything explicitly under /api/
  return (
    /supabase\.co/.test(url.host) ||
    /login\.microsoftonline\.com/.test(url.host) ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  );
}

function isStaticAsset(url) {
  // CRA emits hashed files under /static/. Fonts and icon assets are also
  // safe to cache long-term.
  return (
    url.pathname.startsWith("/static/") ||
    /\.(?:js|css|woff2?|ttf|eot|otf|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(
      url.pathname
    )
  );
}

// --- fetch handler ---
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GETs. Everything else (POST/PUT/PATCH/DELETE) goes straight
  // through to the network — never cached.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip cross-origin URLs we can't trust to be idempotent (e.g. analytics,
  // ad pixels). Google Fonts is the one exception we DO want to cache.
  const isSameOrigin = url.origin === self.location.origin;
  const isGoogleFonts =
    url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";

  // Never cache any API / auth traffic.
  if (isApiRequest(url)) return;

  // Navigation requests: serve cached index.html as fallback when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((r) => r || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first, then network, then opportunistic update.
  if (isSameOrigin && isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Refresh in background (stale-while-revalidate)
          fetch(req)
            .then((fresh) => {
              if (fresh && fresh.ok) {
                caches.open(RUNTIME_CACHE).then((c) => c.put(req, fresh.clone()));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(req).then((fresh) => {
          if (fresh && fresh.ok) {
            const clone = fresh.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          }
          return fresh;
        });
      })
    );
    return;
  }

  // Google Fonts: cache-first.
  if (isGoogleFonts) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((fresh) => {
          if (fresh && fresh.ok) {
            const clone = fresh.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          }
          return fresh;
        });
      })
    );
    return;
  }

  // Default: network-only.
});
