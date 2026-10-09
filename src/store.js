// Zero-dependency JSON store. Atomic writes (temp file + rename) so a crash
// mid-write can never truncate the client's knowledge base or leads.
// Every site gets its own folder under DATA_DIR.

const fs = require("fs");
const path = require("path");

function dataRoot() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data");
}

function siteDir(site) {
  const safe = String(site || "").replace(/[^a-z0-9-_]/gi, "_");
  const dir = path.join(dataRoot(), safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function atomicWrite(file, value) {
  const tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function loadSite(site) {
  return readJson(path.join(siteDir(site), "site.json"), null);
}

function loadKb(site) {
  return readJson(path.join(siteDir(site), "kb.json"), null);
}

function saveKb(site, kb) {
  atomicWrite(path.join(siteDir(site), "kb.json"), kb);
}

function saveSite(site, descriptor) {
  atomicWrite(path.join(siteDir(site), "site.json"), descriptor);
}

function loadConversations(site) {
  return readJson(path.join(siteDir(site), "conversations.json"), []);
}

function saveConversation(site, convo) {
  const all = loadConversations(site);
  const i = all.findIndex((c) => c.id === convo.id);
  if (i >= 0) all[i] = convo;
  else all.push(convo);
  atomicWrite(path.join(siteDir(site), "conversations.json"), all);
}

function loadConversation(site, id) {
  return loadConversations(site).find((c) => c.id === id) || null;
}

function loadLeads(site) {
  return readJson(path.join(siteDir(site), "leads.json"), []);
}

function saveLead(site, lead) {
  const all = loadLeads(site);
  all.push(lead);
  atomicWrite(path.join(siteDir(site), "leads.json"), all);
}

module.exports = {
  dataRoot,
  siteDir,
  loadSite,
  loadKb,
  saveKb,
  saveSite,
  loadConversations,
  loadConversation,
  saveConversation,
  loadLeads,
  saveLead,
};
