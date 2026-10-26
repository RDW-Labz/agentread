// agentread: "this page won't open — read it for me" — one paid call, page text back.
// Deploy: npx wrangler deploy worker.js --name agentread   (free tier, no card)

const PRICE = 0.02;
const ZERO = "0x0000000000000000000000000000000000000000";
const PAY_TO = ZERO; // set via wrangler var PAY_TO=<wallet> to start charging
const UA = "Mozilla/5.0 (compatible; agentread/0.1; +https://agentread.dev/bot)";
const MAX_TEXT = 8000;
const VERSION = "v3"; // bump to bust the edge cache after changing verdict logic

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

const MCP_TOOL = {
  name: "read",
  description: MANIFEST.tools[0].description,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to read" },
      urls: { type: "array", items: { type: "string" }, description: "Up to 40 URLs in one call" },
    },
  },
};

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

async function mcp(req, dry, charge, payTo, ctx) {
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
      return ok({ tools: [MCP_TOOL] });
    case "tools/call": {
      if (!req.headers.get("x-payment") && !dry) {
        return json({ jsonrpc: "2.0", id, error: { code: -32001, message: "payment_required",
          data: { accepts: [{ scheme: "x402", network: "base", asset: "USDC", amount: charge, payTo }] } } }, 402);
      }
      const a = (msg.params || {}).arguments || {};
      const urls = Array.isArray(a.urls)
        ? a.urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 40) : null;
      const [code, body] = await runRead({ target: a.url, urls }, dry, charge, ctx);
      return ok({ content: [{ type: "text", text: JSON.stringify(body) }], isError: code !== 200 });
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

    if (path === "/mcp" && req.method === "POST") return mcp(req, dry, PRICE, payTo, ctx); // MCP JSON-RPC
    if (path === "/openapi.json") return json(OPENAPI); // discovery contract for x402 registries
    if (["/", "/mcp", "/llms.txt", "/api/resources.json"].includes(path)) return json(MANIFEST);
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
    if (!req.headers.get("x-payment") && !dry) {
      return json({ error: "payment_required",
        accepts: [{ scheme: "x402", network: "base", asset: "USDC", amount: charge, payTo }] }, 402);
    }
    const [code, body] = await runRead({ target, urls }, dry, charge, ctx);
    return json(body, code);
  },
};
