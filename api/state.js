"use strict";

const G = require("./_game");
const S = require("./_store");
const V = require("./_view");
const BOT = require("./_bot");

/* Reading is cheap and it also drives the clock: expired rounds close, the
   next one opens and the bot keeps its seat. The opponent's model call lives
   on /api/tick, so a page that only polls for state is never held up. */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const token = String((req.query && req.query.token) || "");
  try {
    const view = await S.withDoc(function (doc) {
      const m = G.ensureMatch(doc, "arena");
      BOT.seat(m);
      G.tick(m);
      return { doc: doc, result: V.view(m, token) };
    });
    return res.status(200).json(view);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
