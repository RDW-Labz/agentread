// agentread: "this page won't open — read it for me" — one paid call, page text back.
// Deploy: npx wrangler deploy worker.js --name agentread   (free tier, no card)

const PRICE = 0.02;
const ZERO = "0x0000000000000000000000000000000000000000";
const PAY_TO = ZERO; // set via wrangler var PAY_TO=<wallet> to start charging
const UA = "Mozilla/5.0 (compatible; agentread/0.1; +https://agentread.dev/bot)";
const MAX_TEXT = 8000;
const VERSION = "v3"; // bump to bust the edge cache after changing verdict logic
const PRICE_CHANGES = 0.01;
const PRICE_SNAPSHOT = 0.01;
const PRICE_SNAPGET = 0.01;
const PRICE_WAIT = 0.02;
const PRICE_COMPARE = 0.02;
const PRICE_SEEN = 0.01;
const PRICE_EXTRACT = 0.01;
const PRICE_DIFF = 0.01;
const FREE_PREVIEWS = 3; // per IP per day: nobody pays for something they could not try
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC, 6 decimals
const NETWORK = "eip155:8453"; // Base mainnet, CAIP-2
const SERVICE = "agentread";

function b64(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// x402 v2 canonical 402: base64 PaymentRequired in a `payment-required` header (+ body for v1 clients)
function bazaarSchema(bazaarIn) {
  const props = { type: { const: bazaarIn.type } };
  if (bazaarIn.method) props.method = { const: bazaarIn.method };
  if (bazaarIn.toolName) props.toolName = { const: bazaarIn.toolName };
  return {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      input: { type: "object", properties: props, required: ["type"], additionalProperties: true },
      output: { type: "object", additionalProperties: true },
    },
    required: ["input"],
  };
}

function challenge({ priceUsd, payTo, reqUrl, method, description, bazaarIn, bazaarOut }) {
  const payload = {
    x402Version: 2,
    resource: { url: reqUrl, method, description, mimeType: "application/json",
                tags: ["agents"], serviceName: SERVICE },
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      amount: String(Math.round(priceUsd * 1e6)), // atomic units: 0.02 USD -> "20000"
      asset: USDC_BASE,
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
    // bazaar = x402's discovery layer: this is what makes the endpoint appear in /discovery/resources
    extensions: { bazaar: { info: { input: bazaarIn, output: bazaarOut }, schema: bazaarSchema(bazaarIn) } },
  };
  return new Response(JSON.stringify(payload), {
    status: 402,
    headers: { "content-type": "application/json", "payment-required": b64(payload) },
  });
}

const MANIFEST = {
  name: "agentread",
  tools: [{
    name: "read",
    price: PRICE,
    description:
      "Read a URL your own fetch failed on and get its actual text back. Use after a 403, 429, " +
      "empty body or garbled page. Returns title and page text as plain markdown; if the page " +
      "genuinely cannot be read, returns verdict (blocked | needs_javascript | paywalled | " +
      "robots_disallowed) and the recommended route. Paid per call via x402. " +
      "POST {urls:[...]} checks up to 40 URLs in one paid call.",
    args: { url: "https://example.com/page", urls: ["https://a.example", "https://b.example"] },
  }, {
    name: "changes",
    price: PRICE_CHANGES,
    description:
      "What changed on this URL since the last check. First call stores a baseline and returns " +
      "first_check; later calls return changed plus the added and removed lines. Use it for " +
      "monitoring across sessions, which an agent cannot do itself. Paid per call via x402.",
    args: { url: "https://example.com/page" },
  }, {
    name: "snapshot", price: PRICE_SNAPSHOT,
    description: "Archive a page's text with a timestamp and hash, so you can prove later what it said. Returns a snapshot_id.",
    args: { url: "https://example.com/page" },
  }, {
    name: "snapshot_get", price: PRICE_SNAPGET,
    description: "Retrieve an archived snapshot by id: original text, title and capture time.",
    args: { id: "a1b2c3d4e5f6a7b8" },
  }, {
    name: "wait_until", price: PRICE_WAIT,
    description: "Block until a page contains a string and return, up to 25 seconds. Saves the caller from sleeping and re-fetching.",
    args: { url: "https://example.com/page", contains: "in stock", max_seconds: 20 },
  }, {
    name: "compare", price: PRICE_COMPARE,
    description: "Diff the visible text of two URLs; returns added and removed lines.",
    args: { url_a: "https://a.example", url_b: "https://b.example" },
  }, {
    name: "first_seen", price: PRICE_SEEN,
    description: "When this exact text was first observed at this URL, from stored history. Distinguishes new content from old.",
    args: { url: "https://example.com/page", text: "some exact sentence" },
  }, {
    name: "links", price: PRICE_EXTRACT,
    description: "All links on a page, resolved to absolute URLs. Use for crawling, link audits or finding where something points.",
    args: { url: "https://example.com/page" },
  }, {
    name: "outline", price: PRICE_EXTRACT,
    description: "The heading structure of a page (h1-h6 with text). Use to understand a long document without reading it.",
    args: { url: "https://example.com/page" },
  }, {
    name: "tables", price: PRICE_EXTRACT,
    description: "HTML tables extracted as JSON arrays of rows. Use for prices, specs, stats and comparison tables.",
    args: { url: "https://example.com/page" },
  }, {
    name: "jsonld", price: PRICE_EXTRACT,
    description: "JSON-LD structured data blocks from a page (Product, Article, Event, Organization). Cleanest source of facts on modern sites.",
    args: { url: "https://example.com/page" },
  }, {
    name: "robots", price: PRICE_EXTRACT,
    description: "robots.txt rules and declared sitemaps for a site. Check before crawling whether an agent is allowed and where to start.",
    args: { url: "https://example.com/page" },
  }, {
    name: "sitemap", price: PRICE_EXTRACT,
    description: "URLs listed in a sitemap, with lastmod. Use to enumerate a site's pages instead of crawling.",
    args: { url: "https://example.com/sitemap.xml" },
  }, {
    name: "feed", price: PRICE_EXTRACT,
    description: "Latest items from an RSS or Atom feed: title, link, date. Cheapest way to see what is new on a site.",
    args: { url: "https://example.com/feed.xml" },
  }, {
    name: "diff", price: PRICE_DIFF,
    description: "Diff two texts you already hold. Returns added and removed lines. No fetch, no page needed.",
    args: { a: "old text", b: "new text" },
  }],
};

function visibleText(body) {
  return (body || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function titleOf(body) {
  const m = (body || "").match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function verdictFor({ status, ctype, raw, text, robots }) {
  const head = (raw || "").toLowerCase().slice(0, 4000); // WAF markers live in the shell only
  const scripts = ((raw || "").match(/<script/gi) || []).length;
  const low = text.toLowerCase();
  let v = "readable", route = "direct_fetch";

  if (status === 402) { v = "paywalled"; route = "do_not_fetch"; }
  else if ([403, 429, 451, 503].includes(status)) { v = "blocked"; route = "render"; }
  else if (status >= 400) { v = "blocked"; route = "do_not_fetch"; }
  // WAF marker alone is not proof: real pages link to "captcha". Only a tiny page is an interstitial.
  else if (text.length < 300 && /captcha|cf-chl|just a moment|attention required|are you a robot/.test(head)) { v = "blocked"; route = "render"; }
  else if (text.length < 3000 && /subscribe to (continue|read)|create a free account to|sign in to read/.test(low)) { v = "paywalled"; route = "find_mirror"; }
  else if (/html/.test(ctype) && text.length < 200 && scripts >= 2) { v = "needs_javascript"; route = "render"; }
  else if (text.length < 50) { v = "blocked"; route = "render"; } // empty shell served with a 200
  return { verdict: v, recommended_route: route };
}

function robotsAllows(txt, path) {
  if (!txt) return { disallowed: false, reason: "no robots.txt" };
  let applies = false;
  const rules = [];
  for (const raw of txt.split("\n")) {
    const line = raw.split("#")[0].trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), val = m[2].trim();
    if (k === "user-agent") applies = val === "*" || /agentread|bot/i.test(val);
    else if (k === "disallow" && applies && val) rules.push(val);
  }
  for (const r of rules) {
    if (r === "/" || path.startsWith(r.replace(/\*$/, ""))) return { disallowed: true, reason: r };
  }
  return { disallowed: false, reason: rules.length ? "path allowed" : "no disallow rule" };
}

export async function readPage(urlStr, doFetch = fetch) {
  const u = new URL(urlStr);
  let robots = { disallowed: false, reason: "no robots.txt" };
  try {
    const r = await doFetch(u.origin + "/robots.txt", { headers: { "User-Agent": UA } });
    if (r.ok) robots = robotsAllows(await r.text(), u.pathname);
  } catch (e) { /* advisory only; a missing robots.txt must not fail the read */ }

  let status = 0, ctype = "", raw = "";
  try {
    const r = await doFetch(urlStr, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
    status = r.status;
    ctype = r.headers.get("content-type") || "";
    raw = (await r.text()).slice(0, 120000);
  } catch (e) {
    return { url: urlStr, status: 0, verdict: "blocked", recommended_route: "do_not_fetch",
             evidence: { error: String(e).slice(0, 120) } };
  }

  const text = /json|text\/plain|xml/.test(ctype)
    ? raw.trim().slice(0, MAX_TEXT)
    : visibleText(raw).slice(0, MAX_TEXT);
  const v = verdictFor({ status, ctype, raw, text, robots });
  return {
    url: urlStr,
    title: titleOf(raw),
    text: v.verdict === "readable" ? text : null,
    robots_disallowed: !!(robots && robots.disallowed), // advisory: caller decides, we do not withhold paid text
    chars: text.length,
    ...v,
    evidence: { http_status: status, content_type: ctype, bytes: raw.length, robots: robots.reason },
  };
}

function hash(s) { // FNV-1a, enough to detect "did this text change"
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0"); // fixed width so concatenated ids are predictable
}

function lineDiff(a, b) {
  const al = a.split("\n").map((s) => s.trim()).filter(Boolean);
  const bl = b.split("\n").map((s) => s.trim()).filter(Boolean);
  const as = new Set(al), bs = new Set(bl);
  const added = bl.filter((l) => !as.has(l));
  const removed = al.filter((l) => !bs.has(l));
  return { added: added.slice(0, 20), removed: removed.slice(0, 20),
           added_count: added.length, removed_count: removed.length };
}

// "what changed here since I last looked" — the one thing a session-bound agent cannot know
async function changes(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_CHANGES, payTo, reqUrl: req.url, method: req.method,
      description: "What changed on this URL since the last check",
      bazaarIn: { type: "http", method: "POST", body: { url: "https://example.com/" } },
      bazaarOut: { type: "json", example: { first_check: true, changed: null, baseline_chars: 171 } } });
  }
  const b = await req.json().catch(() => ({}));
  const target = b.url;
  if (!target || !/^https?:\/\//.test(target)) return json({ error: "url required (http/https)" }, 400);

  const r = await readPage(target);
  const now = new Date().toISOString();
  if (r.verdict !== "readable") {
    return json({ url: target, verdict: r.verdict, recommended_route: r.recommended_route,
                  changed: null, note: "page unreadable; baseline left untouched" });
  }
  const kv = env && env.AGENTREAD_KV;
  const key = "changes:v1:" + target;
  const prev = kv ? await kv.get(key, "json") : null;
  const text = r.text || "";
  const h = hash(text);
  const out = { url: target, title: r.title, checked_at: now };
  if (!prev) {
    Object.assign(out, { first_check: true, changed: null, baseline_chars: text.length,
      note: "baseline stored; call again later to learn what changed" });
  } else {
    const d = lineDiff(prev.text || "", text);
    Object.assign(out, { first_check: false, changed: prev.hash !== h, previous_check_at: prev.at,
      added_count: d.added_count, removed_count: d.removed_count, added: d.added, removed: d.removed });
  }
  if (kv) await kv.put(key, JSON.stringify({ hash: h, text: text.slice(0, 8000), at: now }),
                       { expirationTtl: 60 * 60 * 24 * 30 });
  return json(out);
}

// ---- snapshot: archive a page so its text can be proven later ----
async function snapshot(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_SNAPSHOT, payTo, reqUrl: req.url, method: req.method,
      description: "Archive a page's text with a timestamp and hash",
      bazaarIn: { type: "http", method: "POST", body: { url: "https://example.com/" } },
      bazaarOut: { type: "json", example: { snapshot_id: "a1b2c3d4e5f6a7b8", chars: 171, at: "2026-10-27T18:00:00Z" } } });
  }
  const b = await req.json().catch(() => ({}));
  const target = b.url;
  if (!target || !/^https?:\/\//.test(target)) return json({ error: "url required (http/https)" }, 400);

  const r = await readPage(target);
  if (r.verdict !== "readable") {
    return json({ url: target, verdict: r.verdict, recommended_route: r.recommended_route, note: "nothing archived" });
  }
  const at = new Date().toISOString();
  const text = (r.text || "").slice(0, MAX_TEXT);
  const id = (hash(target + "|" + text + "|" + at) + hash(at + "|" + target)).slice(0, 16); // 64 bits so ids do not collide across users
  const rec = { snapshot_id: id, url: target, title: r.title, at, chars: text.length, hash: hash(text), text };
  const kv = env && env.AGENTREAD_KV;
  if (kv) await kv.put("snap:" + id, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 90 });
  return json({ snapshot_id: id, url: target, title: r.title, at, chars: text.length,
                hash: rec.hash, preview: text.slice(0, 200) });
}

async function snapshotGet(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_SNAPGET, payTo, reqUrl: req.url, method: req.method,
      description: "Retrieve an archived snapshot by id",
      bazaarIn: { type: "http", method: "POST", body: { id: "a1b2c3d4e5f6a7b8" } },
      bazaarOut: { type: "json", example: { snapshot_id: "a1b2c3d4e5f6a7b8", text: "…" } } });
  }
  let id = new URL(req.url).searchParams.get("id");
  if (req.method === "POST") id = (await req.json().catch(() => ({}))).id || id;
  if (!id) return json({ error: "id required" }, 400);
  const kv = env && env.AGENTREAD_KV;
  const rec = kv ? await kv.get("snap:" + id, "json") : null;
  if (!rec) return json({ error: "unknown or expired snapshot", id }, 404);
  return json(rec);
}

// ---- wait_until: block until the page says what the caller is waiting for ----
async function waitUntil(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_WAIT, payTo, reqUrl: req.url, method: req.method,
      description: "Block until a page contains a string, then return",
      bazaarIn: { type: "http", method: "POST",
                  body: { url: "https://example.com/", contains: "in stock", max_seconds: 20 } },
      bazaarOut: { type: "json", example: { matched: true, waited_ms: 6100, attempts: 3 } } });
  }
  const b = await req.json().catch(() => ({}));
  const target = b.url, needle = b.contains;
  if (!target || !needle) return json({ error: "url and contains required" }, 400);
  const maxS = Math.min(Number(b.max_seconds) || 20, 25); // shortcut: 25s ceiling keeps us inside worker limits
  const started = Date.now();
  let attempts = 0, lastVerdict = null;
  while (Date.now() - started < maxS * 1000) {
    attempts++;
    const r = await readPage(target);
    lastVerdict = r.verdict;
    if (r.verdict === "readable" && (r.text || "").includes(needle)) {
      return json({ matched: true, waited_ms: Date.now() - started, attempts, chars: r.chars });
    }
    if (Date.now() - started + 3000 >= maxS * 1000) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  return json({ matched: false, waited_ms: Date.now() - started, attempts, verdict: lastVerdict });
}

// ---- compare: diff two live pages ----
async function compareUrls(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_COMPARE, payTo, reqUrl: req.url, method: req.method,
      description: "Diff the text of two URLs",
      bazaarIn: { type: "http", method: "POST",
                  body: { url_a: "https://example.com/", url_b: "https://example.org/" } },
      bazaarOut: { type: "json", example: { same: false, added_count: 2, removed_count: 1 } } });
  }
  const b = await req.json().catch(() => ({}));
  if (!b.url_a || !b.url_b) return json({ error: "url_a and url_b required" }, 400);
  const [ra, rb] = await Promise.all([readPage(b.url_a), readPage(b.url_b)]);
  if (ra.verdict !== "readable" || rb.verdict !== "readable") {
    return json({ error: "one or both pages unreadable", a: ra.verdict, b: rb.verdict }, 422);
  }
  const d = lineDiff(ra.text || "", rb.text || "");
  return json({ same: d.added_count === 0 && d.removed_count === 0,
                added_count: d.added_count, removed_count: d.removed_count,
                added: d.added, removed: d.removed });
}

// ---- first_seen: when did this text first appear here (from our own history) ----
async function firstSeen(req, env, dry, payTo) {
  if (!req.headers.get("x-payment") && !dry) {
    return challenge({ priceUsd: PRICE_SEEN, payTo, reqUrl: req.url, method: req.method,
      description: "When this exact text was first observed at this URL",
      bazaarIn: { type: "http", method: "POST",
                  body: { url: "https://example.com/", text: "Example Domain" } },
      bazaarOut: { type: "json", example: { is_new: false, first_seen: "2026-10-27T18:00:00Z", age_hours: 3.2 } } });
  }
  const b = await req.json().catch(() => ({}));
  const target = b.url, text = (b.text || "").trim();
  if (!target || !text) return json({ error: "url and text required" }, 400);
  const kv = env && env.AGENTREAD_KV;
  const key = "seen:" + hash(target) + ":" + hash(text);
  const prev = kv ? await kv.get(key, "json") : null;
  const now = new Date().toISOString();
  if (prev) {
    return json({ url: target, text, first_seen: prev.at, is_new: false,
                  age_hours: +(((Date.now() - Date.parse(prev.at)) / 36e5).toFixed(1)) });
  }
  if (kv) await kv.put(key, JSON.stringify({ at: now }), { expirationTtl: 60 * 60 * 24 * 180 });
  return json({ url: target, text, first_seen: now, is_new: true, age_hours: 0,
                note: "first time we have observed this text at this URL" });
}

// ---- shared plumbing for the extractors ----
function gate(req, dry, priceUsd, payTo, description, bazaarIn, bazaarOut) {
  if (req.headers.get("x-payment") || dry) return null;
  return challenge({ priceUsd, payTo, reqUrl: req.url, method: req.method, description, bazaarIn, bazaarOut });
}

async function fetchRaw(u) {
  try {
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow" });
    const body = (await res.text()).slice(0, 300000);
    return { status: res.status, ctype: res.headers.get("content-type") || "", final: res.url || u, body };
  } catch (e) {
    return { status: 0, ctype: "", final: u, body: "", error: String(e).slice(0, 120) };
  }
}

function needUrl(b) {
  const u = (b && b.url) || "";
  return /^https?:\/\//.test(u) ? u : null;
}

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                  .replace(/\s+/g, " ").trim();
}

// ---- free preview: let an agent sample before it pays ----
async function preview(req, env) {
  const url = new URL(req.url);
  let target = url.searchParams.get("url");
  if (req.method === "POST") target = (await req.json().catch(() => ({}))).url || target;
  if (!target || !/^https?:\/\//.test(target)) return json({ error: "url required (http/https)" }, 400);

  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = "pv:" + ip + ":" + day;
  const kv = env && env.AGENTREAD_KV;
  const used = kv ? (Number(await kv.get(key)) || 0) : 0;
  if (used >= FREE_PREVIEWS) {
    return json({ error: "preview_limit_reached", used, limit: FREE_PREVIEWS,
                  note: "paid calls are unaffected: POST /read with an x402 payment" }, 429);
  }
  const r = await readPage(target);
  if (kv) await kv.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return json({ preview: (r.text || "").slice(0, 600), chars: r.chars, verdict: r.verdict,
                recommended_route: r.recommended_route,
                free_previews_left: FREE_PREVIEWS - (used + 1),
                paid_endpoints: ["/read", "/changes", "/snapshot", "/snapshot/get", "/wait",
                                 "/compare", "/first-seen", "/links", "/outline", "/tables",
                                 "/jsonld", "/robots", "/sitemap", "/feed", "/diff"] });
}

// ---- links ----
async function linksTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "Extract and resolve links from a page",
    { type: "http", method: "POST", body: { url: "https://example.com/" } },
    { type: "json", example: { count: 3, links: ["https://example.com/about"] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = needUrl(b);
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const seen = new Set(), out = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(r.body)) && out.length < 200) {
    let href = m[1].trim();
    if (/^(mailto:|javascript:|tel:|data:)/i.test(href)) continue;
    try { href = new URL(href, r.final).toString(); } catch (e) { continue; }
    if (!seen.has(href)) { seen.add(href); out.push(href); }
  }
  return json({ url: target, count: out.length, links: out });
}

// ---- outline (heading structure) ----
async function outlineTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "Heading outline of a page",
    { type: "http", method: "POST", body: { url: "https://example.com/" } },
    { type: "json", example: { count: 2, headings: [{ level: 1, text: "Example Domain" }] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = needUrl(b);
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const headings = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(r.body)) && headings.length < 100) {
    const text = stripTags(m[2]);
    if (text) headings.push({ level: +m[1], text });
  }
  return json({ url: target, count: headings.length, headings });
}

// ---- tables ----
async function tablesTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "Extract HTML tables as JSON",
    { type: "http", method: "POST", body: { url: "https://example.com/" } },
    { type: "json", example: { count: 1, tables: [[["h1", "h2"], ["a", "b"]]] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = needUrl(b);
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const tables = [];
  const tre = /<table\b[\s\S]*?<\/table>/gi;
  let tm;
  while ((tm = tre.exec(r.body)) && tables.length < 5) {
    const rows = [];
    const rre = /<tr\b[\s\S]*?<\/tr>/gi;
    let rm;
    while ((rm = rre.exec(tm[0])) && rows.length < 50) {
      const cells = [];
      const cre = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cre.exec(rm[0])) && cells.length < 20) cells.push(stripTags(cm[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return json({ url: target, count: tables.length, tables });
}

// ---- jsonld ----
async function jsonldTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "Extract JSON-LD structured data",
    { type: "http", method: "POST", body: { url: "https://example.com/" } },
    { type: "json", example: { count: 1, blocks: [{ "@type": "Product" }] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = needUrl(b);
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const blocks = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(r.body)) && blocks.length < 10) {
    try { blocks.push(JSON.parse(m[1].trim())); } catch (e) { /* skip malformed blocks */ }
  }
  return json({ url: target, count: blocks.length, blocks });
}

// ---- robots ----
async function robotsTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "robots.txt rules and sitemaps for a site",
    { type: "http", method: "POST", body: { url: "https://example.com/" } },
    { type: "json", example: { found: true, sitemaps: ["https://example.com/sitemap.xml"] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = needUrl(b);
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const origin = new URL(target).origin;
  const r = await fetchRaw(origin + "/robots.txt");
  const found = r.status === 200 && r.body.trim().length > 0;
  const sitemaps = [], disallow = [], allow = [];
  if (found) {
    let applies = false;
    for (const raw of r.body.split("\n")) {
      const line = raw.split("#")[0].trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent") applies = v === "*" || /agentread|bot/i.test(v);
      else if (k === "sitemap") sitemaps.push(v);
      else if (applies && k === "disallow" && v) disallow.push(v);
      else if (applies && k === "allow" && v) allow.push(v);
    }
  }
  return json({ origin, found, sitemaps: sitemaps.slice(0, 20),
                disallow: disallow.slice(0, 100), allow: allow.slice(0, 50) });
}

// ---- sitemap ----
async function sitemapTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "List URLs from a sitemap",
    { type: "http", method: "POST", body: { url: "https://example.com/sitemap.xml" } },
    { type: "json", example: { count: 12, urls: [{ loc: "https://example.com/a", lastmod: "2026-10-01" }] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = b.url && /^https?:\/\//.test(b.url) ? b.url : null;
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const urls = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(r.body)) && urls.length < 500) {
    const loc = (m[1].match(/<loc>([\s\S]*?)<\/loc>/i) || [])[1];
    const lastmod = (m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/i) || [])[1];
    if (loc) urls.push({ loc: loc.trim(), lastmod: lastmod ? lastmod.trim() : null });
  }
  return json({ url: target, count: urls.length, urls });
}

// ---- feed ----
async function feedTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_EXTRACT, payTo, "Latest items from an RSS or Atom feed",
    { type: "http", method: "POST", body: { url: "https://example.com/feed.xml" } },
    { type: "json", example: { count: 2, items: [{ title: "Post", link: "https://example.com/p" }] } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const target = b.url && /^https?:\/\//.test(b.url) ? b.url : null;
  if (!target) return json({ error: "url required (http/https)" }, 400);
  const r = await fetchRaw(target);
  if (r.status >= 400 || !r.body) return json({ url: target, status: r.status, error: "unreadable" }, 422);
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(r.body)) && items.length < 20) {
    const blk = m[0];
    const title = (blk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const link = (blk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] ||
                 (blk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1];
    const date = (blk.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2];
    items.push({ title: title ? stripTags(title) : null,
                 link: link ? stripTags(link) : null,
                 date: date ? stripTags(date) : null });
  }
  return json({ url: target, count: items.length, items });
}

// ---- diff: two strings the caller supplies, no fetch ----
async function diffTool(req, env, dry, payTo) {
  const g = gate(req, dry, PRICE_DIFF, payTo, "Diff two texts you supply",
    { type: "http", method: "POST", body: { a: "line one", b: "line two" } },
    { type: "json", example: { same: false, added_count: 1, removed_count: 1 } });
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  if (typeof b.a !== "string" || typeof b.b !== "string") return json({ error: "a and b must be strings" }, 400);
  const d = lineDiff(b.a, b.b);
  return json({ same: d.added_count === 0 && d.removed_count === 0,
                added_count: d.added_count, removed_count: d.removed_count,
                added: d.added, removed: d.removed });
}

function json(o, code = 200) {
  return new Response(JSON.stringify(o), { status: code, headers: { "content-type": "application/json" } });
}

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "agentread",
    version: "0.1.0",
    description:
      "Read a URL your own fetch failed on and get the page text back, or a verdict explaining why " +
      "it cannot be read. Built for agents that just got a 403, 429, empty body or JS shell.",
    "x-guidance":
      "Call POST /read with {url} after your own fetch fails. You get back {title, text, verdict, " +
      "recommended_route}. If verdict is 'readable', use text. If it is blocked/needs_javascript/" +
      "paywalled, stop retrying and follow recommended_route. POST {urls:[...]} checks up to 40 " +
      "URLs in one paid call, priced per URL. Pages behind hard bot walls will report 'blocked' " +
      "rather than return fabricated content.",
  },
  paths: {
    "/preview": {
      post: {
        operationId: "preview",
        summary: "Free sample: first 600 chars of a page, 3 per day per IP",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Preview text and verdict" }, "429": { description: "Daily preview limit reached" } },
      },
    },
    "/links": {
      post: {
        operationId: "links",
        summary: "Extract and resolve links from a page",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Absolute links found on the page" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/outline": {
      post: {
        operationId: "outline",
        summary: "Heading outline of a page",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Heading levels and text" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/tables": {
      post: {
        operationId: "tables",
        summary: "Extract HTML tables as JSON",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Array of tables, each an array of rows" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/jsonld": {
      post: {
        operationId: "jsonld",
        summary: "Extract JSON-LD structured data",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Parsed JSON-LD blocks" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/robots": {
      post: {
        operationId: "robots",
        summary: "robots.txt rules and sitemaps",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Rules for automated agents plus sitemap URLs" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/sitemap": {
      post: {
        operationId: "sitemap",
        summary: "List URLs from a sitemap",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Sitemap entries with lastmod" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/feed": {
      post: {
        operationId: "feed",
        summary: "Latest items from an RSS or Atom feed",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Feed items with title, link and date" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/diff": {
      post: {
        operationId: "diff",
        summary: "Diff two texts you supply",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"], additionalProperties: false } } } },
        responses: { "200": { description: "Added and removed lines" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/snapshot": {
      post: {
        operationId: "snapshot",
        summary: "Archive a page's text with timestamp and hash",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string", description: "URL to archive" } }, required: ["url"], additionalProperties: false } } } },
        responses: { "200": { description: "Snapshot id, timestamp, hash and preview" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/snapshot/get": {
      post: {
        operationId: "snapshot_get",
        summary: "Retrieve an archived snapshot",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { id: { type: "string", description: "Snapshot id" } }, required: ["id"], additionalProperties: false } } } },
        responses: { "200": { description: "The archived text" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/wait": {
      post: {
        operationId: "wait_until",
        summary: "Block until a page contains a string",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string", description: "URL to poll" }, contains: { type: "string", description: "String to wait for" } }, required: ["url", "contains"], additionalProperties: false } } } },
        responses: { "200": { description: "matched flag and how long it waited" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.02" }, protocols: [{ x402: {} }] },
      },
    },
    "/compare": {
      post: {
        operationId: "compare",
        summary: "Diff two URLs",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url_a: { type: "string", description: "First URL" }, url_b: { type: "string", description: "Second URL" } }, required: ["url_a", "url_b"], additionalProperties: false } } } },
        responses: { "200": { description: "added/removed lines" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.02" }, protocols: [{ x402: {} }] },
      },
    },
    "/first-seen": {
      post: {
        operationId: "first_seen",
        summary: "When this text was first observed at a URL",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", properties: { url: { type: "string", description: "URL" }, text: { type: "string", description: "Exact text" } }, required: ["url", "text"], additionalProperties: false } } } },
        responses: { "200": { description: "first_seen timestamp and age" }, "400": { description: "Invalid input" }, "402": { description: "Payment Required" } },
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.01" }, protocols: [{ x402: {} }] },
      },
    },
    "/changes": {
      post: {
        operationId: "changes",
        summary: "What changed on this URL since the last check",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            properties: { url: { type: "string", description: "URL to check for changes" } },
            required: ["url"], additionalProperties: false } } },
        },
        responses: {
          "200": { description: "changed flag plus added/removed lines, or first_check when a baseline was just stored" },
          "400": { description: "Missing or invalid url" },
          "402": { description: "Payment Required" },
        },
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: "0.01" },
          protocols: [{ x402: {} }],
        },
      },
    },
    "/read": {
      post: {
        operationId: "read",
        summary: "Read one or more URLs",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", description: "Single URL to read (http/https)" },
                  urls: { type: "array", items: { type: "string" },
                          description: "Up to 40 URLs in one call, priced per URL" },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": { description: "Page text, or a verdict explaining why it is unreadable" },
          "400": { description: "Missing or invalid url" },
          "402": { description: "Payment Required" },
        },
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: "0.02" },
          protocols: [{ x402: {} }],
        },
      },
    },
  },
};

const MCP_TOOLS = [
  { name: "read", description: MANIFEST.tools[0].description, inputSchema: {
      type: "object", properties: {
        url: { type: "string", description: "The URL to read" },
        urls: { type: "array", items: { type: "string" }, description: "Up to 40 URLs in one call" } } } },
  { name: "changes", description: "What changed on a URL since the last check. First call stores a baseline, later calls return changed plus added/removed lines. Survives the caller's session.", inputSchema: {
      type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "snapshot", description: "Archive a page's text with a timestamp and hash so you can prove later what it said. Returns a snapshot_id for snapshot_get.", inputSchema: {
      type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "snapshot_get", description: "Retrieve an archived snapshot by id, with the original text and the time it was captured.", inputSchema: {
      type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "wait_until", description: "Block until a page contains a string, then return. Up to 25 seconds. Use instead of sleeping and re-fetching yourself.", inputSchema: {
      type: "object", properties: { url: { type: "string" }, contains: { type: "string" }, max_seconds: { type: "number" } }, required: ["url", "contains"] } },
  { name: "compare", description: "Diff the visible text of two URLs. Returns added and removed lines.", inputSchema: {
      type: "object", properties: { url_a: { type: "string" }, url_b: { type: "string" } }, required: ["url_a", "url_b"] } },
  { name: "first_seen", description: "When this exact text was first observed at this URL, from stored history. Tells you whether content is new or has been there a while.", inputSchema: {
      type: "object", properties: { url: { type: "string" }, text: { type: "string" } }, required: ["url", "text"] } },
  { name: "links", description: "All links on a page, resolved to absolute URLs.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "outline", description: "Heading structure of a page (h1-h6 with text).", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "tables", description: "HTML tables extracted as JSON arrays of rows.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "jsonld", description: "JSON-LD structured data blocks from a page.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "robots", description: "robots.txt rules and declared sitemaps for a site.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "sitemap", description: "URLs listed in a sitemap, with lastmod.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "feed", description: "Latest items from an RSS or Atom feed.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "diff", description: "Diff two texts you hold; returns added and removed lines.", inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] } },
];

// one read path, used by both the REST route and MCP tools/call
async function runRead({ target, urls }, dry, charge, ctx) {
  if (target && !/^https?:\/\//.test(target)) return [400, { error: "url required (http/https)" }];
  if (!target && !(urls && urls.length)) return [400, { error: "url required (http/https)" }];
  const cache = caches.default;
  const one = async (t) => {
    const key = new Request("https://agentread.internal/" + VERSION + "/" + t, { method: "GET" });
    const hit = await cache.match(key);
    if (hit) return { ...(await hit.json()), cached: true };
    const out = await readPage(t);
    out.cached = false;
    out.checked_at = new Date().toISOString();
    if (dry) out.dry = true;
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), {
      headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
    })));
    return out;
  };
  if (urls) {
    const results = await Promise.all(urls.map(one)); // 40 in parallel, each cached per URL
    return [200, { count: results.length, charged: dry ? 0 : charge, results }];
  }
  return [200, await one(target)];
}

async function mcp(req, env, dry, charge, payTo, ctx) {
  const msg = await req.json().catch(() => null);
  const id = msg && msg.id !== undefined ? msg.id : null;
  const ok = (result) => json({ jsonrpc: "2.0", id, result });
  if (!msg || msg.jsonrpc !== "2.0") {
    return json({ jsonrpc: "2.0", id, error: { code: -32700, message: "parse error" } }, 400);
  }
  switch (msg.method) {
    case "initialize":
      return ok({ protocolVersion: "2024-11-05", capabilities: { tools: {} },
                  serverInfo: { name: "agentread", version: "0.1.0" } });
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: MCP_TOOLS });
    case "tools/call": {
      if (!req.headers.get("x-payment") && !dry) {
        return challenge({ priceUsd: charge, payTo, reqUrl: req.url, method: req.method,
          description: "Read a URL your own fetch failed on",
          bazaarIn: { type: "mcp", toolName: "read", inputSchema: MCP_TOOLS[0].inputSchema,
                      transport: "streamable-http", example: { url: "https://example.com/" } },
          bazaarOut: { type: "json", example: { verdict: "readable", chars: 171 } } });
      }
      const a = (msg.params || {}).arguments || {};
      const name = (msg.params || {}).name;
      if (name === "read") {
        const urls = Array.isArray(a.urls)
          ? a.urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 40) : null;
        const [code, body] = await runRead({ target: a.url, urls }, dry, charge, ctx);
        return ok({ content: [{ type: "text", text: JSON.stringify(body) }], isError: code !== 200 });
      }
      const handler = { changes, snapshot, snapshot_get: snapshotGet, wait_until: waitUntil,
                        compare: compareUrls, first_seen: firstSeen,
                        links: linksTool, outline: outlineTool, tables: tablesTool, jsonld: jsonldTool,
                        robots: robotsTool, sitemap: sitemapTool, feed: feedTool, diff: diffTool }[name];
      if (!handler) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "unknown tool: " + name } }, 200);
      // reuse the REST handler by handing it the same arguments as a POST body
      const synth = new Request("https://agentread.internal/mcp", { method: "POST", headers: req.headers,
                                                                    body: JSON.stringify(a) });
      const res = await handler(synth, env, dry, payTo);
      const out = await res.json();
      return ok({ content: [{ type: "text", text: JSON.stringify(out) }], isError: res.status >= 400 });
    }
    default:
      return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }, 200);
  }
}

export default {
  async fetch(req, env, ctx) {
    const payTo = (env && env.PAY_TO) || PAY_TO;
    const dry = payTo === ZERO; // no wallet configured => free + logged, real traffic data
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/mcp" && req.method === "POST") return mcp(req, env, dry, PRICE, payTo, ctx); // MCP JSON-RPC
    if (path === "/openapi.json") return json(OPENAPI); // discovery contract for x402 registries
    if (["/", "/mcp", "/llms.txt", "/api/resources.json"].includes(path)) return json(MANIFEST);
    if (path === "/changes") return changes(req, env, dry, payTo);
    if (path === "/snapshot") return snapshot(req, env, dry, payTo);
    if (path === "/snapshot/get") return snapshotGet(req, env, dry, payTo);
    if (path === "/wait") return waitUntil(req, env, dry, payTo);
    if (path === "/compare") return compareUrls(req, env, dry, payTo);
    if (path === "/first-seen") return firstSeen(req, env, dry, payTo);
    if (path === "/preview") return preview(req, env); // free, rate-limited
    if (path === "/links") return linksTool(req, env, dry, payTo);
    if (path === "/outline") return outlineTool(req, env, dry, payTo);
    if (path === "/tables") return tablesTool(req, env, dry, payTo);
    if (path === "/jsonld") return jsonldTool(req, env, dry, payTo);
    if (path === "/robots") return robotsTool(req, env, dry, payTo);
    if (path === "/sitemap") return sitemapTool(req, env, dry, payTo);
    if (path === "/feed") return feedTool(req, env, dry, payTo);
    if (path === "/diff") return diffTool(req, env, dry, payTo);
    if (path !== "/read") return json({ error: "not found" }, 404);

    let target = url.searchParams.get("url");
    let urls = null;
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      target = b.url || target;
      if (Array.isArray(b.urls)) urls = b.urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 40);
    }
    const count = urls && urls.length ? urls.length : 1;
    const charge = +(PRICE * count).toFixed(4);
    if (!req.headers.get("x-payment") && !dry) { // gate before validation, as registries probe it
      return challenge({ priceUsd: charge, payTo, reqUrl: req.url, method: req.method,
        description: "Read one or more URLs",
        bazaarIn: { type: "http", method: "POST", body: { url: "https://example.com/" } },
        bazaarOut: { type: "json", example: { verdict: "readable", title: "Example Domain", chars: 171 } } });
    }
    const [code, body] = await runRead({ target, urls }, dry, charge, ctx);
    return json(body, code);
  },
};
