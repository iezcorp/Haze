/* Service worker that routes /proxy/service/* requests through
   Ultraviolet, which forwards them over the BareMux SharedWorker
   (Epoxy Wisp transport, configured by the page). */
importScripts(
  "https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@3.2.10/dist/uv.bundle.js",
  "/proxy/uv.config.js",
  "https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@3.2.10/dist/uv.sw.js",
  "/proxy/bare-mux.js"
);

const uvsw = new self.UVServiceWorker();
const uvErrors = [];
let bareFetchFailure = "";
let bareFetchWrapped = false;
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const error = args.find((value) => value instanceof Error);
  if (error) uvErrors.push(error.stack || error.message || String(error));
  originalConsoleError(...args);
};

/* BareMux resolves the SharedWorker port through an open window client. Do not
   create its service-worker-side client at script startup: the worker can start
   before any window exists, which leaves BareMux holding a rejected port promise. */
let uvBareClientPromise = null;
function ensureBareClient() {
  if (!uvBareClientPromise) {
    uvBareClientPromise = (async () => {
      const client = new BareMux.BareClient("/proxy/bare-mux-worker.js");
      if (!bareFetchWrapped) {
        const originalFetch = client.fetch.bind(client);
        client.fetch = async (...args) => {
          bareFetchFailure = "";
          try {
            const response = await originalFetch(...args);
            if (response.status >= 500) {
              const body = await response.clone().text().catch(() => "");
              bareFetchFailure = "Bare transport returned HTTP " + response.status + " " + response.statusText + (body ? ": " + body.slice(0, 400) : " (empty response body)");
            }
            return response;
          } catch (error) {
            bareFetchFailure = "Bare transport threw: " + (error && error.stack ? error.stack : String(error));
            throw error;
          }
        };
        bareFetchWrapped = true;
      }
      // Confirm the window-to-SharedWorker handoff before Ultraviolet uses the client.
      await client.worker.sendMessage({ type: "get" });
      uvsw.bareClient = client;
    })().catch((err) => {
      // Let a later request retry if no usable window was available yet.
      uvBareClientPromise = null;
      throw err;
    });
  }
  return uvBareClientPromise;
}

/* Take control of open pages immediately (otherwise only pages loaded
   AFTER activation would be intercepted) and apply updates at once. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || !requestUrl.pathname.startsWith("/proxy/service/")) return;
  event.respondWith((async () => {
    const url = event.request.url;
    console.log("[UV SW] Fetch:", url);
    try {
      if (await uvsw.route(event)) {
        console.log("[UV SW] Routing via Ultraviolet");
        await ensureBareClient();
        const transport = await uvsw.bareClient.worker.sendMessage({ type: "get" });
        console.log("[UV SW] BareMux transport:", transport.name || "(none)");
        const errorCount = uvErrors.length;
        const resp = await uvsw.fetch(event);
        if (resp.status === 500 && bareFetchFailure) {
          console.error("[UV SW] Bare transport diagnostic:", bareFetchFailure);
          return new Response(bareFetchFailure, { status: 500 });
        }
        if (resp.status === 500 && uvErrors.length > errorCount) {
          const detail = uvErrors[uvErrors.length - 1];
          console.error("[UV SW] Captured Ultraviolet error:", detail);
          return new Response("Ultraviolet error: " + detail, { status: 500 });
        }
        console.log("[UV SW] UV response:", resp.status, resp.statusText);
        return resp;
      }
      console.log("[UV SW] Passthrough to network");
      return await fetch(event.request);
    } catch (err) {
      console.error("[UV SW] Fetch error:", err);
      return new Response("Proxy error: " + (err && err.message ? err.message : err), { status: 500 });
    }
  })());
});
