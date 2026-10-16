/* Ultraviolet config for the Browsy Epoxy mode.
   Served locally (same origin) so the service worker can import it.
   The heavy libraries (uv bundle/handler/client) load from CDN. */
const UV_VER = "3.2.10";
const UV_LIB = "https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@" + UV_VER + "/dist";

self.__uv$config = {
  prefix: "/proxy/service/",
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: UV_LIB + "/uv.handler.js",
  bundle: UV_LIB + "/uv.bundle.js",
  config: "/proxy/uv.config.js",
  sw: "/proxy/uv.sw.js",
  client: UV_LIB + "/uv.client.js",
};
