"use strict";

const G = require("./_game");
const S = require("./_store");
const V = require("./_view");
const BOT = require("./_bot");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "object" && req.body ? req.body : {};
  try {
    const out = await S.withDoc(function (doc) {
      const m = G.ensureMatch(doc, "arena");
      BOT.seat(m);
      G.tick(m);
      const joined = G.join(doc, "arena", body.name);
      if (joined.error) return { doc: doc, result: { error: joined.error } };
      G.tick(m);
      return {
        doc: doc,
        result: {
          token: joined.player.token,
          player: { name: joined.player.name, id: joined.player.id },
          state: V.view(m, joined.player.token)
        }
      };
    });
    if (out.error) return res.status(400).json(out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
