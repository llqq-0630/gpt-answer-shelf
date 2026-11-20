"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const scripts = manifest.content_scripts.flatMap(script => [...script.js, ...script.css]);
const allowed = new Set([...scripts, "tests/fixture.js", "tests/media-a.svg", "tests/media-b.svg", "tests/concept.svg", "tests/native-concept.svg"]);
const port = Number(process.env.GPT_STICKY_PORT || 8787);
const gallery = new Map();
http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;
  if (pathname === "/tests/gallery") {
    const scenario = requestUrl.searchParams.get("fixture"), id = requestUrl.searchParams.get("id"), key = `${scenario}:${id}`;
    if (request.method === "POST") {
      if (requestUrl.searchParams.has("expire")) {
        for (const [name, item] of gallery) if (name.startsWith(`${scenario}:`)) item.token = "expired";
        response.writeHead(204); response.end(); return;
      }
      const chunks = []; let size = 0;
      request.on("data", chunk => { size += chunk.length; if (size > 12 * 1024 * 1024) request.destroy(); else chunks.push(chunk); });
      request.on("end", () => {
        const token = require("node:crypto").randomUUID();
        gallery.set(key, { bytes: Buffer.concat(chunks), token });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ src: `/tests/gallery?fixture=${encodeURIComponent(scenario)}&id=${encodeURIComponent(id)}&token=${token}`, bytes: size }));
      });
      return;
    }
    const item = gallery.get(key);
    if (!item || item.token !== requestUrl.searchParams.get("token") || !request.headers.cookie?.includes("gpt-fixture-gallery=1")) { response.writeHead(403); response.end("Expired image"); return; }
    response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); response.end(item.bytes); return;
  }
  const relative = pathname.slice(1);
  const file = pathname === "/" || /^\/c\/[\w-]+$/.test(pathname) ? "tests/fixture.html" : allowed.has(relative) ? relative : null;
  if (!file) { response.writeHead(404); response.end("Not found"); return; }
  const headers = { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" };
  // Exercise startup on a page that rejects string-based HTML injection.
  if (file.endsWith(".html") && requestUrl.searchParams.get("strict") === "1") headers["Content-Security-Policy"] = "script-src 'self'; require-trusted-types-for 'script'; trusted-types 'none'";
  response.writeHead(200, headers);
  fs.createReadStream(path.join(root, file)).pipe(response);
}).listen(port, "127.0.0.1", () => { process.stdout.write(`GPT 回答收纳演示：http://127.0.0.1:${port}/c/demo\n`); });
