/* Local harness: the same handler files Vercel runs, behind a plain node http
   server, so a whole match can be played without deploying. */

"use strict";

const http = require("http");

const PORT = Number(process.env.PORT || 8123);

const ROUTES = {
  "/api/state": "./api/state",
  "/api/join": "./api/join",
  "/api/draw": "./api/draw",
  "/api/guess": "./api/guess",
  "/api/pass": "./api/pass",
  "/api/mcp": "./api/mcp",
  "/api/tick": "./api/tick"
};

function wrap(res) {
  const out = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return out; },
    json(obj) {
      out.headers["content-type"] = "application/json";
      res.writeHead(out.statusCode, out.headers);
      res.end(JSON.stringify(obj));
      return out;
    },
    end() { res.writeHead(out.statusCode, out.headers); res.end(); return out; }
  };
  return out;
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try { return resolve(JSON.parse(raw)); } catch (e) { return resolve(raw); }
    });
  });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const file = ROUTES[u.pathname];
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const body = await readBody(req);
  const handler = require(file);
  try {
    await handler({ method: req.method, query, body, headers: req.headers, url: req.url }, wrap(res));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String((e && e.stack) || e) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log("listening on " + PORT));
