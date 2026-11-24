// LOCAL END-TO-END TESTING ONLY. Serves SYNTHETIC records in the shape of the Base Tokenized Stocks API so the
// pagination/parsing path can be exercised offline. Tickers are prefixed "FIXT" and are not real securities.
// Never point a public deployment at this server.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4010);
const tokens = JSON.parse(process.env.FIXTURE_TOKENS ?? "[]");

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const size = Math.min(Number(process.env.FIXTURE_MAX_PAGE ?? 1), Math.max(1, Number(url.searchParams.get("page_size") ?? 100)));
  const start = Number(url.searchParams.get("page_token") ?? 0);
  const page = tokens.slice(start, start + size);
  const body = { tokens: page };
  if (start + size < tokens.length) body.next_page_token = String(start + size);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(port, () => console.log(`fixture api on :${port} (${tokens.length} synthetic tokens)`));
