import page from "../web/index.html";
import { createApp } from "./api";
import { loadConfig } from "./config";
import { storage } from "./db";

const faviconIcoUrl = new URL("../web/assets/favicon.ico", import.meta.url);
const faviconSvgUrl = new URL("../web/assets/favicon.svg", import.meta.url);

function assetResponse(url: URL, contentType: string) {
  return new Response(Bun.file(url), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

const config = loadConfig(),
  store = storage(config),
  app = createApp(store);
const server = Bun.serve({
  hostname: config.listen,
  port: config.port,
  maxRequestBodySize: 2 * 1024 * 1024,
  routes: {
    "/": page,
    "/portal": page,
    "/set-password": page,
    "/favicon.ico": () => assetResponse(faviconIcoUrl, "image/x-icon"),
    "/favicon.svg": () => assetResponse(faviconSvgUrl, "image/svg+xml"),
    "/api/*": app.fetch,
    "/auth/*": app.fetch,
    "/sub/*": app.fetch,
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
  development: process.env.NODE_ENV !== "production",
});
console.log(`Jetyet Web listening at ${server.url}`);
const shutdown = async () => {
  await server.stop();
  store.db.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
