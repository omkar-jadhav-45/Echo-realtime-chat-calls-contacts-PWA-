Frontend (Vite + React + TypeScript)

Environment:
- The client will connect to the socket server at VITE_SOCKET_URL (defaults to http://localhost:3000).

Run:
  npm install
  npm run dev

PWA (manifest + service worker)
- We added a minimal Progressive Web App setup:
  - `public/manifest.webmanifest` with app metadata and an SVG icon at `public/icons/icon.svg`.
  - `public/sw.js` caches the offline shell and serves an `public/offline.html` page when offline.
  - `index.html` links the manifest and icon, and `src/main.tsx` registers the service worker in production.

Notes
- Replace icons with PNGs if you need broader maskable support. Common sizes: 192x192, 512x512.
- Update `theme_color` and `background_color` in `manifest.webmanifest` to match your brand.
- The service worker uses a simple cache-first strategy for same-origin GET requests and a network-first strategy for navigations.
