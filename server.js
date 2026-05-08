/**
 * server.js — QA Assessment Platform
 * Deploy to Railway: https://railway.app
 */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const PORT      = process.env.PORT || 3001;
const API_KEY   = process.env.ANTHROPIC_API_KEY || "";
const HTML_FILE = path.join(__dirname, "test.html");

// Warn but NEVER exit — Railway must stay running to pass health checks
if (!API_KEY) {
  console.warn("WARNING: ANTHROPIC_API_KEY not set. Add it in Railway → Variables tab.");
}

// In-memory test store
const STORE = {};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const u        = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  // ── Health check (Railway pings this) ──────────────────────────────────────
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200); res.end("ok"); return;
  }

  // ── Serve the HTML app ─────────────────────────────────────────────────────
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("test.html not found — make sure it is in the same folder as server.js");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // ── Save test (admin browser → server after generation) ───────────────────
  if (req.method === "POST" && pathname === "/store") {
    try {
      const data = JSON.parse(await readBody(req));
      if (!data.id) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing id" })); return; }
      STORE[data.id] = data;
      console.log(`[STORE] saved: ${data.name} (${data.id})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Update test (candidate submits) ───────────────────────────────────────
  if (req.method === "POST" && pathname === "/store/update") {
    try {
      const data = JSON.parse(await readBody(req));
      if (!data.id || !STORE[data.id]) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
      STORE[data.id] = { ...STORE[data.id], ...data };
      console.log(`[STORE] updated: ${STORE[data.id].name} → ${data.status}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Fetch test by ID (candidate opens link) ────────────────────────────────
  if (req.method === "GET" && pathname === "/store") {
    const tid = u.searchParams.get("id");
    if (!tid || !STORE[tid]) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(STORE[tid]));
    return;
  }

  // ── Proxy to Anthropic API ─────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api") {
    if (!API_KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "ANTHROPIC_API_KEY not set on server. Add it in Railway → Variables tab." } }));
      return;
    }
    try {
      const payload = await readBody(req);
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01"
        }
      };
      const proxyReq = https.request(options, proxyRes => {
        let data = "";
        proxyRes.on("data", chunk => { data += chunk; });
        proxyRes.on("end", () => {
          console.log(`[API] ${proxyRes.statusCode}`);
          res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
          res.end(data);
        });
      });
      proxyReq.on("error", err => {
        console.error("Proxy error:", err.message);
        res.writeHead(502); res.end(JSON.stringify({ error: err.message }));
      });
      proxyReq.write(payload);
      proxyReq.end();
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
