import { readPage } from "./worker.js";
const cases = [
  ["https://example.com/", "readable"],
  ["https://github.com/octocat", "readable"],
  ["https://www.reddit.com/", "blocked"],
  ["https://en.wikipedia.org/wiki/Model_Context_Protocol", "readable"], // robots.txt must not withhold text
  ["https://www.nytimes.com/", ["blocked", "paywalled"]],
];
let fails = 0;
for (const [u, want] of cases) {
  const r = await readPage(u);
  const ok = [].concat(want).includes(r.verdict);
  const textOk = r.verdict !== "readable" || (r.text && r.text.length > 40);
  if (!ok || !textOk) fails++;
  console.log((ok && textOk ? "PASS " : "FAIL ") + u.padEnd(30) + r.verdict + " text=" +
    (r.text ? r.text.length + 'ch "' + r.text.slice(0, 60).replace(/\n/g, " ") + '…"' : "null"));
}
console.log(fails ? fails + " failed" : "all pass");
process.exit(fails ? 1 : 0);
