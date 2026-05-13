/**
 * server.js — QA Assessment Platform
 * Deploy to Railway. Set these environment variables in Railway → Variables:
 *   GROQ_API_KEY       — from console.groq.com (free: 30 RPM, 6000 RPD)
 *   BREVO_API_KEY      — from app.brevo.com (free: 300 emails/day, no domain needed)
 *   BREVO_FROM_EMAIL   — the email you registered with on Brevo e.g. yourname@gmail.com
 *   BREVO_FROM_NAME    — display name e.g. QA Assessment (optional, defaults to "QA Assessment")
 */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const PORT             = process.env.PORT            || 3001;
const API_KEY          = process.env.GROQ_API_KEY    || "";
const BREVO_KEY        = process.env.BREVO_API_KEY   || "";
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL|| "";
const BREVO_FROM_NAME  = process.env.BREVO_FROM_NAME || "QA Assessment";
const PUBLIC_URL       = (process.env.PUBLIC_URL     || "").replace(/\/$/, "");
const HTML_FILE        = path.join(__dirname, "test.html");

const STORE  = {};
const CONFIG = { resultEmails: [] };
const RATE   = { count: 0, windowStart: Date.now() };

function trackRequest() {
  const now = Date.now(), elapsed = now - RATE.windowStart;
  RATE.count++;
  if (elapsed >= 60000) {
    console.log(`[RATE] ${RATE.count} req in last ${Math.round(elapsed/1000)}s → ~${Math.round(RATE.count/(elapsed/60000))} RPM`);
    RATE.count = 1; RATE.windowStart = now;
  } else {
    const rpm = Math.round(RATE.count / (elapsed / 60000));
    console.log(`[RATE] Req #${RATE.count} | ${Math.round(elapsed/1000)}s elapsed | ~${isFinite(rpm) ? rpm : RATE.count} RPM`);
  }
}

if (!API_KEY)          console.warn("WARNING: GROQ_API_KEY not set.");
if (!BREVO_KEY)        console.warn("WARNING: BREVO_API_KEY not set — emails will not send.");
if (!BREVO_FROM_EMAIL) console.warn("WARNING: BREVO_FROM_EMAIL not set.");
if (!PUBLIC_URL)       console.warn("WARNING: PUBLIC_URL not set — candidate links may use localhost. Set it to your Railway URL.");
else                   console.log(`✅ Public URL: ${PUBLIC_URL}`);
if (BREVO_KEY && BREVO_FROM_EMAIL) console.log(`✅ Brevo ready. Sending from: ${BREVO_FROM_EMAIL}`);

// ── Brevo HTTP helper (port 443 — never blocked by Railway) ──────────────────
function sendViaBrevo(toEmail, toName, subject, html) {
  return new Promise((resolve, reject) => {
    if (!BREVO_KEY)        { reject(new Error("BREVO_API_KEY not set in Railway Variables.")); return; }
    if (!BREVO_FROM_EMAIL) { reject(new Error("BREVO_FROM_EMAIL not set in Railway Variables.")); return; }

    const payload = JSON.stringify({
      sender:   { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
      to:       [{ email: toEmail, name: toName || toEmail }],
      subject,
      htmlContent: html
    });

    const opts = {
      hostname: "api.brevo.com",
      path:     "/v3/smtp/email",
      method:   "POST",
      headers:  {
        "api-key":        BREVO_KEY,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(opts, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[EMAIL] ✅ Sent to ${toEmail}`);
          resolve(true);
        } else {
          try { reject(new Error(JSON.parse(data).message || `Brevo ${res.statusCode}`)); }
          catch(e) { reject(new Error(`Brevo HTTP ${res.statusCode}: ${data}`)); }
        }
      });
    });
    req.on("error", reject);
    req.write(payload); req.end();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ── Email templates ──────────────────────────────────────────────────────────
function candidateEmailHTML(d) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
  <h2 style="color:#1a1a2e">📋 Your Assessment Invitation</h2>
  <p>Hello <strong>${d.to_name}</strong>,</p>
  <p>You have been invited to take an online assessment.</p>
  <div style="text-align:center;margin:32px 0">
    <a href="${d.test_link}" style="background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">🚀 Start My Assessment</a>
  </div>
  <p style="color:#666;font-size:14px">⏰ Valid until: <strong>${d.expires_date}</strong></p>
  <p style="color:#666;font-size:14px">📊 Difficulty: <strong>${d.difficulty}</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">If the button does not work, copy this link: ${d.test_link}</p>
</div></body></html>`;
}

function resultsEmailHTML(d) {
  const p = d.score_pct >= 35;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
  <h2 style="color:#1a1a2e">📊 Assessment Result — ${d.candidate_name}</h2>
  <div style="background:${p?'#f0fdf4':'#fef2f2'};border-radius:8px;padding:20px;margin:20px 0;text-align:center">
    <div style="font-size:36px;font-weight:bold;color:${p?'#16a34a':'#dc2626'}">${d.score_marks}</div>
    <div style="font-size:20px;color:${p?'#16a34a':'#dc2626'}">${d.score_pct}% — ${p?'PASSED ✅':'FAILED ❌'}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Candidate</td><td style="padding:10px;border:1px solid #e5e7eb"><strong>${d.candidate_name}</strong> (${d.candidate_email})</td></tr>
    <tr><td style="padding:10px;border:1px solid #e5e7eb">Difficulty</td><td style="padding:10px;border:1px solid #e5e7eb">${d.difficulty}</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Correct</td><td style="padding:10px;border:1px solid #e5e7eb;color:#16a34a"><strong>${d.correct}</strong></td></tr>
    <tr><td style="padding:10px;border:1px solid #e5e7eb">Wrong</td><td style="padding:10px;border:1px solid #e5e7eb;color:#dc2626"><strong>${d.wrong}</strong></td></tr>
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Skipped</td><td style="padding:10px;border:1px solid #e5e7eb">${d.skipped}</td></tr>
    <tr><td style="padding:10px;border:1px solid #e5e7eb">Time Taken</td><td style="padding:10px;border:1px solid #e5e7eb">${d.time_taken}</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Submitted</td><td style="padding:10px;border:1px solid #e5e7eb">${d.date}</td></tr>
  </table>
  <h3>Answer Breakdown</h3>
  <pre style="background:#f8f9fa;padding:16px;border-radius:8px;font-size:12px;white-space:pre-wrap">${d.breakdown}</pre>
</div></body></html>`;
}

function candidateResultEmailHTML(d) {
  const p = d.score_pct >= 35;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
  <h2 style="color:#1a1a2e">✅ Assessment Submitted</h2>
  <p>Hello <strong>${d.candidate_name}</strong>, thank you for completing the assessment.</p>
  <div style="background:${p?'#f0fdf4':'#fef2f2'};border-radius:8px;padding:20px;margin:20px 0;text-align:center">
    <div style="font-size:36px;font-weight:bold;color:${p?'#16a34a':'#dc2626'}">${d.score_marks}</div>
    <div style="font-size:20px;color:${p?'#16a34a':'#dc2626'}">${d.score_pct}% — ${p?'PASSED ✅':'FAILED ❌'}</div>
  </div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Correct</td><td style="padding:10px;border:1px solid #e5e7eb;color:#16a34a"><strong>${d.correct} / 25</strong></td></tr>
    <tr><td style="padding:10px;border:1px solid #e5e7eb">Wrong</td><td style="padding:10px;border:1px solid #e5e7eb;color:#dc2626"><strong>${d.wrong}</strong></td></tr>
    <tr style="background:#f8f9fa"><td style="padding:10px;border:1px solid #e5e7eb">Time Taken</td><td style="padding:10px;border:1px solid #e5e7eb">${d.time_taken}</td></tr>
  </table>
  <p style="color:#666;font-size:14px;margin-top:16px">The assessment team has been notified of your result.</p>
</div></body></html>`;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200); res.end("ok"); return;
  }

  // ── Public URL — frontend uses this for candidate link generation ───────────
  if (req.method === "GET" && pathname === "/public-url") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: PUBLIC_URL || null }));
    return;
  }

  if (req.method === "GET" && pathname === "/env-check") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      GROQ_API_KEY:      API_KEY          ? `✅ SET (${API_KEY.length} chars)`    : "❌ NOT SET",
      BREVO_API_KEY:     BREVO_KEY        ? `✅ SET (${BREVO_KEY.length} chars)`  : "❌ NOT SET",
      BREVO_FROM_EMAIL:  BREVO_FROM_EMAIL ? `✅ SET → ${BREVO_FROM_EMAIL}`        : "❌ NOT SET",
      BREVO_FROM_NAME:   BREVO_FROM_NAME,
      PUBLIC_URL:        PUBLIC_URL       ? `✅ SET → ${PUBLIC_URL}`              : "❌ NOT SET — candidate links will use browser origin",
      email_ready:       (BREVO_KEY && BREVO_FROM_EMAIL) ? "✅ YES" : "❌ NO — set BREVO_API_KEY and BREVO_FROM_EMAIL then REDEPLOY"
    }, null, 2));
    return;
  }

  if (req.method === "GET" && pathname === "/test-email") {
    try {
      await sendViaBrevo(BREVO_FROM_EMAIL, "Test", "✅ QA Platform — Email Test", `<p>Email working via Brevo. Sent: ${new Date().toISOString()}</p>`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Test email sent to ${BREVO_FROM_EMAIL} via Brevo — check your inbox!` }));
    } catch(e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end("test.html not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

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

  if (req.method === "GET" && pathname === "/store") {
    const tid = u.searchParams.get("id");
    if (!tid || !STORE[tid]) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "not_found" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(STORE[tid]));
    return;
  }

  if (req.method === "POST" && pathname === "/config") {
    try {
      const data = JSON.parse(await readBody(req));
      if (Array.isArray(data.resultEmails)) {
        CONFIG.resultEmails = data.resultEmails;
        console.log(`[CONFIG] emails: ${CONFIG.resultEmails.join(", ")}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === "GET" && pathname === "/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ resultEmails: CONFIG.resultEmails }));
    return;
  }

  if (req.method === "POST" && pathname === "/send-email") {
    try {
      const { type, data } = JSON.parse(await readBody(req));
      if (!BREVO_KEY || !BREVO_FROM_EMAIL) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "BREVO_API_KEY or BREVO_FROM_EMAIL not set in Railway Variables." }));
        return;
      }
      if (type === "candidate_invite") {
        await sendViaBrevo(data.to_email, data.to_name, `📋 Your Assessment Invitation — ${data.to_name}`, candidateEmailHTML(data));
      } else if (type === "results") {
        const recips = (data.result_emails && data.result_emails.length) ? data.result_emails : CONFIG.resultEmails;
        for (const to of recips) {
          await sendViaBrevo(to, to, `📊 Assessment Result — ${data.candidate_name} (${data.score_pct}%)`, resultsEmailHTML(data));
        }
        await sendViaBrevo(data.candidate_email, data.candidate_name, `✅ Your Assessment Result — ${data.score_pct}%`, candidateResultEmailHTML(data));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      console.error("[EMAIL ERROR]", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api") {
    if (!API_KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "GROQ_API_KEY not set in Railway Variables." } }));
      return;
    }
    try {
      trackRequest();
      const body = JSON.parse(await readBody(req));
      const groqPayload = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: body.messages || [],
        max_tokens: body.max_tokens || 8000,
        temperature: 0.7
      });
      const opts = {
        hostname: "api.groq.com", path: "/openai/v1/chat/completions", method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(groqPayload),
          "Authorization":  `Bearer ${API_KEY}`
        }
      };
      const proxyReq = https.request(opts, proxyRes => {
        let data = "";
        proxyRes.on("data", chunk => { data += chunk; });
        proxyRes.on("end", () => {
          console.log(`[GROQ] ${proxyRes.statusCode}`);
          try {
            const r = JSON.parse(data);
            if (proxyRes.statusCode !== 200) {
              res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { message: r.error?.message || "Groq error" } }));
              return;
            }
            const text = r.choices?.[0]?.message?.content || "";
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ content: [{ type: "text", text }] }));
          } catch(e) { res.writeHead(502); res.end(JSON.stringify({ error: "Bad Groq response" })); }
        });
      });
      proxyReq.on("error", err => { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); });
      proxyReq.write(groqPayload); proxyReq.end();
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ QA Assessment Server running on port ${PORT}`);
});
