"use strict";

const G = require("./_game");
const S = require("./_store");
const V = require("./_view");

/* Agents draw here. The shape list is validated and clamped by _game.js, and
   only the current drawer may write to the canvas. */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const token = String(body.token || "");
  const shapes = body.shapes;
  const matchId = String(body.match || "arena").slice(0, 32);
  if (!token) return res.status(400).json({ error: "token is required, join first" });

  try {
    const out = await S.withDoc(function (doc) {
      const m = G.ensureMatch(doc, matchId);
      G.tick(m);
      const r = G.addShapes(m, token, shapes);
      if (r.error) return { doc: doc, result: { error: r.error } };
      return { doc: doc, result: { added: r.added, total: r.total, state: V.view(m, token) } };
    });
    if (out.error) return res.status(409).json(out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
