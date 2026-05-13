/**
 * server.js — QA Assessment Platform
 * Deploy to Railway. Set these environment variables in Railway → Variables:
 *   GROQ_API_KEY       — from console.groq.com (free tier: 30 RPM, 6000 RPD)
 *   GMAIL_USER         — your Gmail address e.g. yourname@gmail.com
 *   GMAIL_PASS         — Gmail App Password (NOT your login password)
 *                        Get it: Google Account → Security → 2FA → App Passwords
 */

const http       = require("http");
const https      = require("https");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");

const PORT      = process.env.PORT || 3001;
const API_KEY   = process.env.GROQ_API_KEY || "";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_PASS = process.env.GMAIL_PASS || "";
const HTML_FILE = path.join(__dirname, "test.html");

// In-memory test store
const STORE = {};

// In-memory config store (result emails saved by admin, used when candidates submit)
const CONFIG = { resultEmails: [] };

if (!API_KEY)   console.warn("WARNING: GROQ_API_KEY not set. Add it in Railway → Variables.");
if (!GMAIL_USER || !GMAIL_PASS) console.warn("WARNING: GMAIL_USER or GMAIL_PASS not set. Emails will not be sent.");

function getTransporter() {
  if (!GMAIL_USER || !GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
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

function candidateEmailHTML(data) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h2 style="color:#1a1a2e">📋 Your Assessment Invitation</h2>
    <p>Hello <strong>${data.to_name}</strong>,</p>
    <p>You have been invited to take an online assessment. Please click the button below to begin:</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${data.test_link}" style="background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">
        🚀 Start My Assessment
      </a>
    </div>
    <p style="color:#666;font-size:14px">⏰ This link is valid until: <strong>${data.expires_date}</strong></p>
    <p style="color:#666;font-size:14px">📊 Difficulty level: <strong>${data.difficulty}</strong></p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#999;font-size:12px">If the button doesn't work, copy this link: ${data.test_link}</p>
  </div>
</body>
</html>`;
}

function resultsEmailHTML(data) {
  const passed = data.score_pct >= 35;
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h2 style="color:#1a1a2e">📊 Assessment Result — ${data.candidate_name}</h2>
    <div style="background:${passed?'#f0fdf4':'#fef2f2'};border-radius:8px;padding:20px;margin:20px 0;text-align:center">
      <div style="font-size:36px;font-weight:bold;color:${passed?'#16a34a':'#dc2626'}">${data.score_marks}</div>
      <div style="font-size:20px;color:${passed?'#16a34a':'#dc2626'}">${data.score_pct}% — ${passed?'PASSED ✅':'FAILED ❌'}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Candidate</td>
        <td style="padding:10px;border:1px solid #e5e7eb"><strong>${data.candidate_name}</strong> (${data.candidate_email})</td>
      </tr>
      <tr>
        <td style="padding:10px;border:1px solid #e5e7eb">Difficulty</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${data.difficulty}</td>
      </tr>
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Correct</td>
        <td style="padding:10px;border:1px solid #e5e7eb;color:#16a34a"><strong>${data.correct}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px;border:1px solid #e5e7eb">Wrong</td>
        <td style="padding:10px;border:1px solid #e5e7eb;color:#dc2626"><strong>${data.wrong}</strong></td>
      </tr>
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Skipped</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${data.skipped}</td>
      </tr>
      <tr>
        <td style="padding:10px;border:1px solid #e5e7eb">Time Taken</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${data.time_taken}</td>
      </tr>
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Submitted</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${data.date}</td>
      </tr>
    </table>
    <h3 style="color:#1a1a2e">Answer Breakdown</h3>
    <pre style="background:#f8f9fa;padding:16px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap">${data.breakdown}</pre>
  </div>
</body>
</html>`;
}

function candidateResultEmailHTML(data) {
  const passed = data.score_pct >= 35;
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h2 style="color:#1a1a2e">✅ Assessment Submitted</h2>
    <p>Hello <strong>${data.candidate_name}</strong>,</p>
    <p>Thank you for completing the assessment. Here is your result:</p>
    <div style="background:${passed?'#f0fdf4':'#fef2f2'};border-radius:8px;padding:20px;margin:20px 0;text-align:center">
      <div style="font-size:36px;font-weight:bold;color:${passed?'#16a34a':'#dc2626'}">${data.score_marks}</div>
      <div style="font-size:20px;color:${passed?'#16a34a':'#dc2626'}">${data.score_pct}% — ${passed?'PASSED ✅':'FAILED ❌'}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Correct Answers</td>
        <td style="padding:10px;border:1px solid #e5e7eb;color:#16a34a"><strong>${data.correct} / 25</strong></td>
      </tr>
      <tr>
        <td style="padding:10px;border:1px solid #e5e7eb">Wrong Answers</td>
        <td style="padding:10px;border:1px solid #e5e7eb;color:#dc2626"><strong>${data.wrong}</strong></td>
      </tr>
      <tr style="background:#f8f9fa">
        <td style="padding:10px;border:1px solid #e5e7eb">Time Taken</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${data.time_taken}</td>
      </tr>
    </table>
    <p style="color:#666;font-size:14px">The assessment team has been notified of your result.</p>
  </div>
</body>
</html>`;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const u        = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  // ── Health check ────────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200); res.end("ok"); return;
  }

  // ── Serve HTML ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end("test.html not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // ── Save test ────────────────────────────────────────────────────────────────
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

  // ── Update test ─────────────────────────────────────────────────────────────
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

  // ── Fetch test by ID ────────────────────────────────────────────────────────
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

  // ── Save/fetch config (result emails) ──────────────────────────────────────
  if (req.method === "POST" && pathname === "/config") {
    try {
      const data = JSON.parse(await readBody(req));
      if (Array.isArray(data.resultEmails)) {
        CONFIG.resultEmails = data.resultEmails;
        console.log(`[CONFIG] result emails updated: ${CONFIG.resultEmails.join(", ")}`);
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

  // ── Send email ──────────────────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/send-email") {
    try {
      const { type, data } = JSON.parse(await readBody(req));
      const transporter = getTransporter();
      if (!transporter) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Email not configured. Set GMAIL_USER and GMAIL_PASS in Railway Variables." }));
        return;
      }

      console.log(`[EMAIL] Attempting to send ${type} from ${GMAIL_USER}`);

      if (type === "candidate_invite") {
        console.log(`[EMAIL] invite → ${data.to_email}`);
        await transporter.sendMail({
          from: `"QA Assessment" <${GMAIL_USER}>`,
          to: data.to_email,
          subject: `📋 Your Assessment Invitation — ${data.to_name}`,
          html: candidateEmailHTML(data)
        });
        console.log(`[EMAIL] invite SENT to ${data.to_email}`);
      }

      else if (type === "results") {
        // Use emails from request body; fall back to server-stored config
        const recipientList = (data.result_emails && data.result_emails.length)
          ? data.result_emails
          : CONFIG.resultEmails;

        if (!recipientList.length) {
          console.warn("[EMAIL] No result recipients configured — skipping admin emails.");
        }

        // Send to all result recipients
        for (const to of recipientList) {
          console.log(`[EMAIL] results → ${to}`);
          await transporter.sendMail({
            from: `"QA Assessment" <${GMAIL_USER}>`,
            to,
            subject: `📊 Assessment Result — ${data.candidate_name} (${data.score_pct}%)`,
            html: resultsEmailHTML(data)
          });
          console.log(`[EMAIL] results SENT to ${to}`);
        }
        // Also send result to the candidate
        console.log(`[EMAIL] candidate result → ${data.candidate_email}`);
        await transporter.sendMail({
          from: `"QA Assessment" <${GMAIL_USER}>`,
          to: data.candidate_email,
          subject: `✅ Your Assessment Result — ${data.score_pct}%`,
          html: candidateResultEmailHTML(data)
        });
        console.log(`[EMAIL] candidate result SENT to ${data.candidate_email}`);
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

  // ── Proxy to Groq API (OpenAI-compatible, free tier) ───────────────────────
  if (req.method === "POST" && pathname === "/api") {
    if (!API_KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "GROQ_API_KEY not set. Add it in Railway → Variables." } }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));

      // Groq uses OpenAI-compatible format
      const groqPayload = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: body.messages || [],
        max_tokens: body.max_tokens || 8000,
        temperature: 0.7
      });

      const options = {
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(groqPayload),
          "Authorization": `Bearer ${API_KEY}`
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        let data = "";
        proxyRes.on("data", chunk => { data += chunk; });
        proxyRes.on("end", () => {
          console.log(`[GROQ API] ${proxyRes.statusCode}`);
          try {
            const groqResp = JSON.parse(data);
            if (proxyRes.statusCode !== 200) {
              res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { message: groqResp.error?.message || "Groq API error" } }));
              return;
            }
            // Convert Groq/OpenAI response → Anthropic-style so frontend works unchanged
            const text = groqResp.choices?.[0]?.message?.content || "";
            const converted = { content: [{ type: "text", text }] };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(converted));
          } catch(e) {
            res.writeHead(502); res.end(JSON.stringify({ error: "Failed to parse Groq response" }));
          }
        });
      });
      proxyReq.on("error", err => {
        console.error("Groq proxy error:", err.message);
        res.writeHead(502); res.end(JSON.stringify({ error: err.message }));
      });
      proxyReq.write(groqPayload);
      proxyReq.end();
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ QA Assessment Server running on port ${PORT}`);
});
