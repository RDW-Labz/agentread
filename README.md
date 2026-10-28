# agentread

Read a URL your own fetch failed on, and get the page text back — or a clear verdict on why it can't be read.

An agent hits a 403, a 429, an empty body, or a JavaScript shell. Instead of retrying blindly, it calls `agentread` with that URL and gets either the page text as markdown, or a verdict telling it to stop and try a different route.

## Endpoint

Base: `https://agentread.midi-thumb.workers.dev`

| Call | What it does |
|---|---|
| `GET /read?url=…` | Read one URL |
| `POST /read {"urls":[…]}` | Read up to 40 in one call |
| `POST /changes {url}` | What changed since the last check ($0.01) |
| `POST /snapshot {url}` | Archive a page with timestamp + hash, get a snapshot id ($0.01) |
| `POST /snapshot/get {id}` | Retrieve an archived snapshot ($0.01) |
| `POST /wait {url,contains}` | Block until the page matches, up to 25s ($0.02) |
| `POST /compare {url_a,url_b}` | Diff two live pages ($0.02) |
| `POST /first-seen {url,text}` | When this text was first observed here ($0.01) |
| `POST /preview {url}` | **Free** — first 600 chars, 3/day per IP |
| `GET /` · `/mcp` · `/llms.txt` | Free tool manifest |

```bash
curl "https://agentread.midi-thumb.workers.dev/read?url=https://example.com/"
```

```json
{
  "url": "https://example.com/",
  "title": "Example Domain",
  "text": "Example Domain This domain is for use in documentation examples…",
  "chars": 171,
  "verdict": "readable",
  "recommended_route": "direct_fetch",
  "robots_disallowed": false,
  "evidence": { "http_status": 200, "content_type": "text/html", "bytes": 577 }
}
```

When it cannot read a page it says so, and says why:

```json
{ "verdict": "blocked", "recommended_route": "render", "text": null,
  "evidence": { "http_status": 403 } }
```

Verdicts: `readable` · `blocked` · `needs_javascript` · `paywalled`.
Routes: `direct_fetch` · `render` · `find_mirror` · `do_not_fetch`.

## What it actually does, measured

Tested against 9 real sites: **4 returned page text.**

| Site | Result |
|---|---|
| example.com | readable |
| en.wikipedia.org | readable (8000 chars) |
| x.com | readable |
| docs.stripe.com | readable |
| github.com | flaky — sometimes 429 |
| news.ycombinator.com | blocked (419) |
| reddit.com | blocked (empty shell) |
| nytimes.com | blocked (403) |
| amazon.com | blocked |

**It does not bypass bot protection.** It runs on Cloudflare Workers, whose egress IPs are shared and widely blocked. Pages behind hard bot walls report `blocked` — that answer is accurate and still useful, because it stops an agent burning calls, but it is not the text.

## Pricing

$0.02 per URL to read, $0.01 per change check, over x402 (USDC on Base, `eip155:8453`). Batches are priced per URL.

Unpaid calls return HTTP 402 with the canonical x402 v2 challenge: a base64 `PaymentRequired` object in the `payment-required` header, `amount` in USDC atomic units (`"20000"` = $0.02), asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

Listed on x402scan (`Successfully registered 2 of 2 resources`), merchant page `tryponcho.com/m/agentread.midi-thumb.workers.dev`.

## Deploy your own

```bash
npx wrangler deploy worker.js --name agentread --compatibility-date 2026-10-19
```

Set a wallet to start charging:

```bash
npx wrangler secret put PAY_TO   # or a [vars] entry with your EVM address
```

With no `PAY_TO`, every request is free and responses carry `"dry": true`.

## Tests

```bash
node test.mjs        # 5 real sites, asserts verdicts
node test-http.mjs   # 9 checks: paywall, batch pricing, cache, blocked pages
```

No dependencies — Node 18+ (global `fetch`) and the standard library only.
