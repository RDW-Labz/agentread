import { default as w } from "./worker.js";
const store = new Map();
globalThis.caches = { default: {
  match: async (req) => {
    const body = store.get(req.url);
    return body === undefined ? undefined : new Response(body, { headers: { "content-type": "application/json" } });
  },
  put: async (req, res) => { store.set(req.url, await res.text()); },
}};
const call = async (path, opts = {}, env = {}) => {
  const r = await w.fetch(new Request("https://agentread.dev" + path, opts), env, { waitUntil: (p) => p });
  return [r.status, await r.json()];
};
const WALLET = { PAY_TO: "0xabc123" }; // turns the paywall on for tests
let fails = 0;
const check = (name, cond, extra) => {
  if (!cond) { fails++; console.log("FAIL", name, JSON.stringify(extra).slice(0, 300)); }
  else console.log("PASS", name);
};

let [s, b] = await call("/mcp");
check("manifest free, priced 0.25", s === 200 && b.tools[0].price === 0.02 && b.tools[0].name === "read", b);

[s, b] = await call("/read?url=notaurl");
check("rejects bad url", s === 400, b);

[s, b] = await call("/read?url=https://example.com/", {}, WALLET);
check("402 without payment", s === 402 && b.accepts[0].amount === 0.02, b);

[s, b] = await call("/read?url=https://example.com/", { headers: { "x-payment": "stub" } }, WALLET);
check("paid returns page text", s === 200 && b.verdict === "readable" && b.text.length > 40 && b.cached === false, b);

[s, b] = await call("/read?url=https://example.com/", { headers: { "x-payment": "stub" } }, WALLET);
check("cached on second call", s === 200 && b.cached === true, b);

[s, b] = await call("/read?url=https://example.org/"); // fresh URL, no cache
check("free when no wallet configured", s === 200 && b.dry === true, b);

[s, b] = await call("/read", { method: "POST", headers: { "x-payment": "stub", "content-type": "application/json" },
  body: JSON.stringify({ url: "https://www.nytimes.com/" }) });
check("blocked site: verdict + route, no text", s === 200 && b.verdict === "blocked" && b.text === null && b.recommended_route, b);

[s, b] = await call("/read", { method: "POST", headers: { "x-payment": "stub", "content-type": "application/json" },
  body: JSON.stringify({ urls: ["https://example.com/", "https://www.nytimes.com/", "not-a-url"] }) }, WALLET);
check("batch: 3 urls, invalid dropped, charged 0.04",
  s === 200 && b.count === 2 && b.charged === 0.04 && b.results.length === 2, b);

[s, b] = await call("/read", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ urls: ["https://example.com/"] }) }, WALLET);
check("batch 402 priced per url", s === 402 && b.accepts[0].amount === 0.02, b);

console.log(fails ? fails + " failed" : "all pass");
process.exit(fails ? 1 : 0);
