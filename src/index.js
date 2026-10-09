// SiteChat AI server. One Express app, no database, no build step.
//   GET  /health                  -> liveness
//   GET  /api/:site/config        -> widget config (public)
//   POST /api/:site/chat          -> chat turn (public)
//   POST /api/:site/lead          -> visitor leaves contact (public)
//   GET  /widget/embed.js         -> the widget script (public)
//   POST /api/:site/ingest        -> retrain from a URL (admin)
//   GET  /api/:site/leads        -> captured leads (admin)
//   GET  /api/:site/conversations -> chat log (admin)

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { chat } = require("./chatbot");
const { ingest } = require("./scraper");
const {
  loadSite,
  loadKb,
  loadConversation,
  saveConversation,
  loadLeads,
  saveLead,
} = require("./store");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-admin-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function adminOnly(req, res, next) {
  const key = req.get("x-admin-key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function siteName(site) {
  const d = loadSite(site);
  return (d && d.name) || site;
}

function notify(site, text) {
  const via = (process.env.NOTIFY_VIA || "log").toLowerCase();
  if (via === "log" || via === "both") {
    console.log(`[sitechat:${site}] ${text}`);
  }
  if (via === "telegram" || via === "both") {
    const token = process.env.BUSINESS_TELEGRAM_TOKEN;
    const chatId = process.env.BUSINESS_TELEGRAM_CHAT_ID;
    if (token && chatId) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch(() => {});
    }
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/:site/config", (req, res) => {
  const kb = loadKb(req.params.site);
  if (!kb) return res.status(404).json({ error: "unknown site" });
  res.json({
    name: siteName(req.params.site),
    quickReplies: [
      "What are your opening hours?",
      "What's on the menu?",
      "Where are you located?",
      "Do you deliver?",
    ],
    whatsapp: process.env.BUSINESS_WHATSAPP || "",
    email: process.env.BUSINESS_EMAIL || "",
    offlineMessage: process.env.OFFLINE_MESSAGE || "",
  });
});

app.post("/api/:site/chat", async (req, res) => {
  const site = req.params.site;
  if (!loadKb(site)) return res.status(404).json({ error: "unknown site" });

  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "empty message" });

  const sessionId = req.body.sessionId || crypto.randomUUID();
  let convo = loadConversation(site, sessionId);
  if (!convo) convo = { id: sessionId, site, createdAt: new Date().toISOString(), messages: [] };

  const history = convo.messages.slice();
  convo.messages.push({ role: "user", content: message });

  const result = await chat({ site, message, history });

  convo.messages.push({ role: "assistant", content: result.reply });
  convo.updatedAt = new Date().toISOString();
  saveConversation(site, convo);

  if (result.collect_contact) {
    notify(site, `Lead moment: visitor asked "${message}" and was asked for contact details.`);
  }

  res.json({
    reply: result.reply,
    sessionId,
    needs_human: result.needs_human,
    collect_contact: result.collect_contact,
    intent: result.intent,
  });
});

app.post("/api/:site/lead", (req, res) => {
  const site = req.params.site;
  if (!loadKb(site)) return res.status(404).json({ error: "unknown site" });

  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const contact = typeof req.body.contact === "string" ? req.body.contact.trim() : "";
  if (!contact) return res.status(400).json({ error: "contact required" });

  saveLead(site, {
    sessionId: req.body.sessionId || null,
    name,
    contact,
    business: siteName(site),
    at: new Date().toISOString(),
  });

  notify(site, `NEW LEAD: ${name || "(no name)"} — ${contact}`);
  res.json({ ok: true });
});

app.get("/widget/embed.js", (req, res) => {
  const file = path.join(__dirname, "widget.js");
  if (!fs.existsSync(file)) return res.status(404).type("text").send("// widget missing");
  res.type("application/javascript").send(fs.readFileSync(file, "utf8"));
});

app.post("/api/:site/ingest", adminOnly, async (req, res) => {
  const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const result = await ingest(req.params.site, url);
    res.json({ ok: true, pages: result.pages, name: result.name });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.get("/api/:site/leads", adminOnly, (req, res) => {
  res.json(loadLeads(req.params.site));
});

app.get("/api/:site/conversations", adminOnly, (req, res) => {
  const fsx = require("fs");
  const file = path.join(
    process.env.DATA_DIR || path.join(__dirname, "..", "data"),
    String(req.params.site).replace(/[^a-z0-9-_]/gi, "_"),
    "conversations.json"
  );
  try {
    res.json(JSON.parse(fsx.readFileSync(file, "utf8")));
  } catch (e) {
    res.json([]);
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3009;
  app.listen(port, () => {
    console.log(`SiteChat AI listening on http://localhost:${port}`);
    console.log(`Embed: <script src="http://localhost:${port}/widget/embed.js" data-site="homefoodpro"></script>`);
  });
}

module.exports = app;
