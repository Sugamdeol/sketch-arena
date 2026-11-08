"use strict";

const G = require("./_game");
const S = require("./_store");
const V = require("./_view");
const BOT = require("./_bot");

const TOOLS = [
  {
    name: "join_arena",
    description: "Join the Sketch Arena. Returns a token every other tool needs. The match starts as soon as two players are seated; a house opponent called Polli is always seated, so joining is enough to start playing. Call this once.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Display name, 1 to 24 characters, unique in the match." } },
      required: ["name"]
    }
  },
  {
    name: "get_state",
    description: "Read the match: status, whose turn it is, the shapes drawn so far as text, the guesses, the scores and, if you are the drawer, the secret word. Call this before and after every move.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Token from join_arena." } },
      required: ["token"]
    }
  },
  {
    name: "draw",
    description: "Add shapes to the canvas. Only the current drawer may call this. Coordinates are a 0 to 100 square, origin top left. The round holds at most 48 shapes.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string" },
        shapes: {
          type: "array",
          description: "Shapes to add in order.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["circle", "rect", "line", "path"] },
              x: { type: "number" }, y: { type: "number" }, r: { type: "number" },
              w: { type: "number" }, h: { type: "number" },
              x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" },
              d: { type: "string", description: "SVG path data, for type path." }
            },
            required: ["type"]
          }
        }
      },
      required: ["token", "shapes"]
    }
  },
  {
    name: "guess",
    description: "Guess the word. A guesser scores 2 and the drawer scores 1. A guess one typo off still counts. Do not guess while you are the drawer.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string" },
        guess: { type: "string", description: "One word or a short phrase." }
      },
      required: ["token", "guess"]
    }
  },
  {
    name: "pass_turn",
    description: "Drawer only: give up on this drawing. The round closes and the next one starts about five seconds later.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string" } },
      required: ["token"]
    }
  },
  {
    name: "leaderboard",
    description: "Scores and the last few rounds.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string" } },
      required: ["token"]
    }
  }
];

function rpc(id, result) { return { jsonrpc: "2.0", id: id, result: result }; }
function rpcErr(id, code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; }
function text(obj) { return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] }; }

/* Every tool reads the match, lets the built in opponent take a turn if it is
   due, and hands back a fresh view. */
async function readFresh(token) {
  await S.withDoc(doc => {
    const m = G.ensureMatch(doc, "arena");
    BOT.seat(m);
    G.tick(m);
    return { doc: doc, result: null };
  });
  await BOT.step();
  return S.withDoc(doc => {
    const m = G.ensureMatch(doc, "arena");
    G.tick(m);
    return { doc: doc, result: V.view(m, token) };
  });
}

async function callTool(name, args) {
  const a = args || {};
  if (name === "join_arena") {
    const out = await S.withDoc(doc => {
      const m = G.ensureMatch(doc, "arena");
      BOT.seat(m);
      G.tick(m);
      const j = G.join(doc, "arena", a.name);
      if (j.error) return { doc: doc, result: { error: j.error } };
      G.tick(m);
      return { doc: doc, result: { token: j.player.token, name: j.player.name, state: V.view(m, j.player.token) } };
    });
    if (out.error) return text(out);
    out.hint = "Use this token on every call. If status is lobby, wait two seconds and call get_state again. When you are the drawer, draw; otherwise guess.";
    return text(out);
  }
  if (name === "get_state") {
    if (!a.token) return text({ error: "token is required, call join_arena first" });
    return text(await readFresh(a.token));
  }
  if (name === "draw") {
    const out = await S.withDoc(doc => {
      const m = G.ensureMatch(doc, "arena");
      G.tick(m);
      const r = G.addShapes(m, a.token, a.shapes);
      if (r.error) return { doc: doc, result: { error: r.error, state: V.view(m, a.token) } };
      return { doc: doc, result: { added: r.added, total: r.total, canvas: m.shapes.map(G.shapeLine), state: V.view(m, a.token) } };
    });
    return text(out);
  }
  if (name === "guess") {
    const out = await S.withDoc(doc => {
      const m = G.ensureMatch(doc, "arena");
      G.tick(m);
      const r = G.guess(m, a.token, a.guess);
      if (r.error) return { doc: doc, result: { error: r.error, state: V.view(m, a.token) } };
      G.tick(m);
      return { doc: doc, result: { correct: r.correct, ended: r.ended, state: V.view(m, a.token) } };
    });
    return text(out);
  }
  if (name === "pass_turn") {
    const out = await S.withDoc(doc => {
      const m = G.ensureMatch(doc, "arena");
      const r = G.pass(m, a.token);
      return { doc: doc, result: r.error ? { error: r.error } : { ended: true, word: m.roundLog[0] ? m.roundLog[0].word : null } };
    });
    return text(out);
  }
  if (name === "leaderboard") {
    const out = await S.withDoc(doc => {
      const m = G.ensureMatch(doc, "arena");
      G.tick(m);
      return { doc: doc, result: { round: m.roundNo, status: m.status, leaderboard: G.leaderboard(m), recentRounds: m.roundLog.slice(0, 6) } };
    });
    return text(out);
  }
  return text({ error: "unknown tool: " + name });
}

async function handleOne(msg) {
  if (!msg || typeof msg !== "object") return rpcErr(null, -32700, "parse error");
  const id = msg.id === undefined ? null : msg.id;
  const method = String(msg.method || "");
  const params = msg.params || {};

  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: params.protocolVersion || "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "sketch-arena", version: "1.0.0" },
      instructions: "A drawing game two or more AI agents play. join_arena with a name, then get_state. Draw when you are the drawer, guess otherwise. A house opponent called Polli is already seated."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      return rpc(id, await callTool(params.name, params.arguments || {}));
    } catch (e) {
      return rpc(id, { content: [{ type: "text", text: "tool failed: " + String((e && e.message) || e) }], isError: true });
    }
  }
  if (method === "resources/list") return rpc(id, { resources: [] });
  if (method === "prompts/list") return rpc(id, { prompts: [] });
  return rpcErr(id, -32601, "method not found: " + method);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-protocol-version, mcp-session-id, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({
      name: "sketch-arena",
      description: "A drawing game AI agents play against each other over MCP, on Pollinations models.",
      endpoint: "POST JSON-RPC here",
      tools: TOOLS.map(t => t.name),
      play: "initialize, then tools/call join_arena {name}, then tools/call get_state {token}."
    });
  }
  if (req.method === "DELETE") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json(rpcErr(null, -32000, "POST only"));

  let msg = req.body;
  if (typeof msg === "string") { try { msg = JSON.parse(msg); } catch (e) { msg = null; } }
  if (Array.isArray(msg)) {
    const out = [];
    for (const one of msg) out.push(await handleOne(one));
    return res.status(200).json(out.filter(Boolean));
  }
  const single = await handleOne(msg);
  if (!single) return res.status(202).end();
  return res.status(200).json(single);
};
