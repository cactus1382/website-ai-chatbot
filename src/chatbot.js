// Core chat logic: retrieve from the client's own site, call the LLM through
// any OpenAI-compatible endpoint (works via OpenRouter from Iran), and NEVER
// let the bot invent a fact. If the answer is not in the content, escalate.

const { buildSystemPrompt } = require("./prompts");
const { loadKb, loadSite } = require("./store");

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "and", "or", "to", "in",
  "for", "on", "at", "by", "with", "from", "how", "much", "what", "when", "where",
  "who", "do", "does", "did", "you", "your", "please", "can", "could", "would",
  "i", "me", "my", "we", "our", "us", "it", "this", "that", "have", "has",
]);

function client() {
  const OpenAI = require("openai");
  const opts = { apiKey: process.env.OPENAI_API_KEY || "missing-key" };
  if (process.env.OPENAI_BASE_URL) opts.baseURL = process.env.OPENAI_BASE_URL;
  return new OpenAI(opts);
}

function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9ـ۰-۹]+/g)) || [];
}

function scoreChunk(text, query) {
  const terms = [...new Set(tokenize(query).filter((t) => t.length > 2 && !STOP_WORDS.has(t)))];
  if (!terms.length) return 0;
  const low = String(text || "").toLowerCase();
  let score = 0;
  for (const t of terms) {
    score += low.split(t).length - 1;
  }
  return score / terms.length;
}

function chunkPages(pages, size = 1200) {
  const chunks = [];
  for (const p of pages || []) {
    const text = p.text || "";
    if (!text.trim()) {
      chunks.push({ url: p.url, title: p.title || p.url, text: "" });
      continue;
    }
    for (let i = 0; i < text.length; i += size) {
      chunks.push({
        url: p.url,
        title: p.title || p.url,
        text: text.slice(i, i + size),
      });
    }
  }
  return chunks;
}

function topChunks(kb, query, limit = 6) {
  const chunks = chunkPages((kb && kb.pages) || []);
  return chunks
    .map((c) => ({ ...c, score: scoreChunk(c.text, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function kbContextFor(kb, query) {
  const chunks = topChunks(kb, query);
  if (!chunks.length) return "(no website content ingested yet)";
  return chunks
    .map((c, i) => `--- page ${i + 1}: ${c.title} (${c.url}) ---\n${c.text}`)
    .join("\n\n");
}

function fallbackReply() {
  return {
    reply:
      "I'm not certain about that. Could you leave your email or phone number so we can get back to you?",
    needs_human: true,
    intent: "unanswered",
    collect_contact: true,
  };
}

async function chat({ site, message, history }) {
  const kb = loadKb(site) || { pages: [] };
  const descriptor = loadSite(site) || {};
  const siteName = descriptor.name || site;

  const system = buildSystemPrompt({
    siteName,
    kbContext: kbContextFor(kb, message),
  });

  const messages = [{ role: "system", content: system }];
  for (const h of history || []) {
    if (h && h.role && h.content) messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: message });

  const model = process.env.MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const openai = client();
    const res = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.2,
    });
    const raw = (res.choices && res.choices[0] && res.choices[0].message.content) || "";
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return {
        reply: String(parsed.reply || fallbackReply().reply),
        needs_human: !!parsed.needs_human,
        intent: String(parsed.intent || "general"),
        collect_contact: !!parsed.collect_contact,
      };
    }
    return { reply: trimmed || fallbackReply().reply, needs_human: false, intent: "general", collect_contact: false };
  } catch (e) {
    return fallbackReply();
  }
}

module.exports = { chat, kbContextFor, topChunks, chunkPages, scoreChunk, fallbackReply };
