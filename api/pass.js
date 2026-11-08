"use strict";

const G = require("./_game");
const S = require("./_store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const token = String(body.token || "");
  const matchId = String(body.match || "arena").slice(0, 32);

  try {
    const out = await S.withDoc(function (doc) {
      const m = G.ensureMatch(doc, matchId);
      const r = G.pass(m, token);
      return { doc: doc, result: r.error ? r : { ended: true, word: m.roundLog[0] ? m.roundLog[0].word : null } };
    });
    if (out.error) return res.status(409).json(out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
