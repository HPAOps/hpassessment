// Register the service worker for production builds. We deliberately
// skip registration in development (so HMR works) and on localhost
// (so dev tooling isn't confused).
//
// Update behavior is SILENT: when a new version lands the service worker
// installs in the background but does NOT activate. The next time the
// student/teacher opens the app, they get the new version. This is the
// safest pattern for a kiosk-mode assessment app — no chance of a
// mid-test reload.

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  // Wait for window load so the SW registration doesn't compete with
  // the first paint.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[HPA] Service worker registration failed:", err);
      });
  });
}
