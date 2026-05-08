/**
 * server.js — QA Assessment Platform server
 * Deploy to Railway: https://railway.app
 * API key is set via environment variable ANTHROPIC_API_KEY (never hardcoded)
 */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");

// On Railway: set ANTHROPIC_API_KEY in environment variables dashboard
// Locally: set it in your terminal before running: set ANTHROPIC_API_KEY=sk-ant-...
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const PORT      = process.env.PORT || 3001;
const HTML_FILE = path.join(__dirname, "test.html");

// ── In-memory test store (persists for the lifetime of the server process) ────
const TEST_STORE = {};

if (!ANTHROPIC_API_KEY) {
  console.error("\n❌  ERROR: ANTHROPIC_API_KEY environment variable is not set!");
  console.error("    On Railway: add it in Variables tab.");
  console.error("    Locally: run  set ANTHROPIC_API_KEY=sk-ant-...  then restart.\n");
  process.exit(1);
}

// Get local IP so admin knows what link to share with candidates
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

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

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  // Strip trailing slash for cleaner matching


  // ── Serve HTML app (with ?test= passthrough) ───────────────────────────────
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(404); res.end("test.html not found. Make sure proxy.js and test.html are in the same folder."); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // ── Save test data (called by admin browser after generation) ─────────────
  if (req.method === "POST" && pathname === "/store") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data.id) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing id" })); return; }
      TEST_STORE[data.id] = data;
      console.log(`[STORE] Saved test for: ${data.name} (id: ${data.id})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Update test data (called when candidate submits) ──────────────────────
  if (req.method === "POST" && pathname === "/store/update") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data.id || !TEST_STORE[data.id]) { res.writeHead(404); res.end(JSON.stringify({ error: "Test not found" })); return; }
      TEST_STORE[data.id] = { ...TEST_STORE[data.id], ...data };
      console.log(`[STORE] Updated test for: ${TEST_STORE[data.id].name} — status: ${data.status}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Fetch test data by ID (called by candidate browser on link open) ───────
  if (req.method === "GET" && pathname === "/store") {
    const tid = url.searchParams.get("id");
    if (!tid || !TEST_STORE[tid]) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(TEST_STORE[tid]));
    return;
  }

  // ── Proxy to Anthropic API ─────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const payload = JSON.stringify(parsed);

      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": ANTHROPIC_API_KEY,
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
    } catch(e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅  QA Assessment Server running on port ${PORT}`);
  console.log(`    If running locally: http://localhost:${PORT}\n`);
});