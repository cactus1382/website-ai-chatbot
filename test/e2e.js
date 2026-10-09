// End-to-end tests for the website chatbot.
// Stubs the LLM and HTTP so the whole chat -> escalation -> lead flow runs
// without network access.
process.env.OPENAI_API_KEY = "sk-test";
process.env.DATA_DIR = require("path").join(require("os").tmpdir(), "wcb_test_data");
process.env.ALLOWED_ORIGIN = "*";
process.env.NOTIFY_VIA = "log";
process.env.MODEL = "gpt-4o-mini";
process.env.ADMIN_KEY = "test-admin-key";
process.env.PORT = "0";

const fs = require("fs");
const path = require("path");
const http = require("http");

const dataDir = process.env.DATA_DIR;
fs.rmSync(dataDir, { force: true, recursive: true });
fs.mkdirSync(path.join(dataDir, "homefoodpro"), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, "..", "data", "homefoodpro", "site.json"),
  path.join(dataDir, "homefoodpro", "site.json")
);
fs.copyFileSync(
  path.join(__dirname, "..", "data", "homefoodpro", "kb.json"),
  path.join(dataDir, "homefoodpro", "kb.json")
);

let nextReply = "Our Ghormeh Sabzi is 185,000 Toman including delivery.";
let shouldFail = false;
let shouldNeedHuman = false;
let lastMessages = null;
const openaiPath = require.resolve("openai");
require.cache[openaiPath] = {
  id: openaiPath,
  filename: openaiPath,
  loaded: true,
  paths: [],
  exports: function FakeOpenAI() {
    return {
      chat: {
        completions: {
          create: async (opts) => {
            if (shouldFail) throw new Error("simulated API outage");
            lastMessages = opts.messages;
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      reply: nextReply,
                      needs_human: shouldNeedHuman,
                      intent: "menu enquiry",
                      collect_contact: shouldNeedHuman,
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    };
  },
};

const fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts });
  if (String(url).startsWith("https://api.telegram.org")) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  const page = STUB_PAGES[String(url)];
  if (!page) {
    return { ok: false, status: 404, text: async () => "not found" };
  }
  return { ok: true, status: 200, text: async () => page };
};

const STUB_PAGES = {
  "https://example-site.com/": [
    "<html><head><title>Example Bistro</title></head><body>",
    '<h1>Example Bistro</h1><p>We are a family restaurant open Tuesday to Sunday, 12:00 to 22:00.</p>',
    '<p>Our pizza is 12 euros. <a href="/menu">Full menu</a> · <a href="/contact">Contact</a></p>',
    "</body></html>",
  ].join(""),
  "https://example-site.com/menu": [
    "<html><head><title>Menu - Example Bistro</title></head><body>",
    "<h1>Menu</h1><ul><li>Margherita - 10 euros</li><li>Pepperoni - 12 euros</li></ul>",
    "</body></html>",
  ].join(""),
  "https://example-site.com/contact": [
    "<html><head><title>Contact</title></head><body>",
    "<h1>Contact</h1><p>Call us at +1 555 0100. We are closed on Mondays.</p>",
    "</body></html>",
  ].join(""),
};

const app = require("../src/index.js");

let failures = 0;
function check(cond, label) {
  console.log((cond ? "PASS  " : "FAIL  ") + label);
  if (!cond) failures++;
}

function request(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        path: urlPath,
        method,
        headers: Object.assign(
          { "content-type": "application/json" },
          data ? { "content-length": Buffer.byteLength(data) } : {},
          headers || {}
        ),
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = chunks ? JSON.parse(chunks) : null;
          } catch (e) {
            parsed = chunks;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

let server;

(async () => {
  server = app;

  if (!server || !server.address) {
    server = require("http").createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  }

  const base = "/api/homefoodpro";

  let res = await request("GET", "/health");
  check(res.status === 200 && res.body.status === "ok", "health endpoint ok");

  res = await request("GET", `${base}/config`);
  check(res.status === 200 && res.body.name === "HomeFoodPro", "widget config returns business name");
  check(Array.isArray(res.body.quickReplies) && res.body.quickReplies.length > 0, "widget config has quick replies");

  res = await request("GET", "/api/does-not-exist/config");
  check(res.status === 404, "unknown site 404s");

  res = await request("POST", `${base}/chat`, { message: "How much is the Ghormeh Sabzi?" });
  check(res.status === 200, "chat returns 200");
  check(res.body.reply.includes("185,000"), "chat answers with the KB price");
  check(typeof res.body.sessionId === "string" && res.body.sessionId.length > 0, "session id issued");
  check(lastMessages && lastMessages[0].content.includes("WEBSITE CONTENT"), "system prompt includes KB");
  check(lastMessages && lastMessages.some((m) => m.role === "user" && m.content.includes("Ghormeh")), "user message reaches LLM");

  const sid = res.body.sessionId;
  res = await request("POST", `${base}/chat`, { message: "and delivery?", sessionId: sid });
  check(res.body.sessionId === sid, "session preserved across turns");
  check(
    lastMessages.some((m) => m.role === "user" && m.content.includes("Ghormeh")),
    "history carries the previous turn"
  );

  shouldNeedHuman = true;
  nextReply = "I'm not certain about that. Could you leave your email or phone so we can get back to you?";
  res = await request("POST", `${base}/chat`, { message: "Do you cater for 80 people?" });
  check(res.body.needs_human === true, "needs_human surfaced to widget");
  check(res.body.collect_contact === true, "widget asked to collect contact");

  res = await request("POST", `${base}/lead`, {
    sessionId: sid,
    name: "Test Customer",
    contact: "test@example.com",
  });
  check(res.status === 200 && res.body.ok === true, "lead accepted");
  const leads = JSON.parse(fs.readFileSync(path.join(dataDir, "homefoodpro", "leads.json"), "utf8"));
  check(leads.length === 1, "lead persisted to leads.json");
  check(leads[0].contact === "test@example.com", "lead stores contact");
  check(leads[0].business === "HomeFoodPro", "lead tagged with business name");

  res = await request("POST", `${base}/lead`, { sessionId: sid, name: "No Contact" });
  check(res.status === 400, "lead without contact 400s");

  res = await request("POST", `${base}/chat`, { message: "" });
  check(res.status === 400, "empty message 400s");

  shouldFail = true;
  res = await request("POST", `${base}/chat`, { message: "hello?" });
  shouldFail = false;
  check(res.status === 200, "AI failure still returns 200");
  check(res.body.collect_contact === true, "AI failure falls back to contact collection");
  check(res.body.needs_human === true, "AI failure flagged needs_human");

  res = await request("POST", `${base}/ingest`, { url: "https://example-site.com/" });
  check(res.status === 401, "ingest without admin key 401s");

  res = await request("POST", `${base}/ingest`, { url: "https://example-site.com/" }, { "x-admin-key": "wrong" });
  check(res.status === 401, "ingest with wrong admin key 401s");

  res = await request("POST", `${base}/ingest`, { url: "https://example-site.com/" }, { "x-admin-key": "test-admin-key" });
  check(res.status === 200 && res.body.ok === true, "ingest succeeds with admin key");
  check(res.body.pages >= 2, "ingest crawled more than one page");
  const kb = JSON.parse(fs.readFileSync(path.join(dataDir, "homefoodpro", "kb.json"), "utf8"));
  check(kb.pages.length >= 2, "ingested KB persisted to kb.json");
  check(kb.pages.some((p) => p.text.includes("12 euros")), "ingested KB contains page text");
  check(kb.pages.some((p) => p.url.includes("/menu")), "ingest followed internal links");

  res = await request("GET", `${base}/leads`);
  check(res.status === 401, "leads without admin key 401s");
  res = await request("GET", `${base}/leads`, null, { "x-admin-key": "test-admin-key" });
  check(res.status === 200 && Array.isArray(res.body), "leads endpoint returns list with admin key");

  res = await new Promise((resolve) => {
    http
      .get({ host: "127.0.0.1", port: server.address().port, path: "/widget/embed.js" }, (r) => {
        let c = "";
        r.on("data", (x) => (c += x));
        r.on("end", () => resolve({ status: r.statusCode, body: c }));
      })
      .on("error", () => resolve({ status: 0, body: "" }));
  });
  check(res.status === 200 && res.body.includes("wcb-"), "widget embed.js served");
  check(res.body.includes("data-site"), "widget reads data-site attribute");

  res = await request("POST", `${base}/chat`, { message: "How much is a pizza?" });
  nextReply = "A Margherita is 10 euros.";
  res = await request("POST", `${base}/chat`, { message: "How much is a pizza?" });
  check(res.status === 200, "chat still works after re-ingest");
  check(
    lastMessages[0].content.includes("Example Bistro") || lastMessages[0].content.includes("euros"),
    "chat prompt now reflects the ingested site content"
  );

  console.log("");
  console.log(failures === 0 ? "ALL E2E CHECKS PASSED" : failures + " CHECK(S) FAILED");
  server.close();
  fs.rmSync(dataDir, { force: true, recursive: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
