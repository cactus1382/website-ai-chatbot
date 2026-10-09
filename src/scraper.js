// Site ingester. Given a URL, crawl the site's own pages, strip the HTML to
// text, and write site.json + kb.json. This is the "trained on your website in
// ten minutes" promise made real. Uses global fetch so it runs anywhere Node 18+.

const { saveSite, saveKb, loadSite } = require("./store");

const MAX_PAGES = 25;

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractLinks(html, base) {
  const out = [];
  const re = /<a\s[^>]*?href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (/^(javascript:|data:)/i.test(href)) continue;
    let resolved;
    try {
      resolved = new URL(href, base).href;
    } catch (e) {
      continue;
    }
    if (resolved.startsWith("mailto:") || resolved.startsWith("tel:")) continue;
    out.push(resolved);
  }
  return [...new Set(out)];
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch (e) {
    return false;
  }
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "SiteChatAI/1.0 (+site ingestion)" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  return { html, finalUrl: url };
}

async function ingest(site, startUrl) {
  const start = new URL(startUrl);
  const origin = start.origin;
  const queue = [start.href];
  const visited = new Set();
  const pages = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let page;
    try {
      page = await fetchPage(url);
    } catch (e) {
      continue;
    }
    if (!page) continue;
    const text = stripHtml(page.html);
    if (text.length < 40) continue;
    pages.push({ url: page.finalUrl, title: extractTitle(page.html) || page.finalUrl, text });
    for (const link of extractLinks(page.html, page.finalUrl)) {
      if (sameOrigin(link, origin) && !visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }
  }

  const existing = loadSite(site) || {};
  const name = existing.name || extractTitle("") || origin.replace(/^https?:\/\//, "");

  const descriptor = {
    name,
    baseUrl: origin,
    startUrl: start.href,
    scrapedAt: new Date().toISOString(),
    pages,
  };

  saveSite(site, descriptor);
  saveKb(site, { name, generatedAt: new Date().toISOString(), pages });

  return { name, pages: pages.length, descriptor };
}

module.exports = { ingest, stripHtml, extractTitle, extractLinks };
