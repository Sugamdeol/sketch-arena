"use strict";

const BOT = require("./_bot");

/* Lets the house opponent take one turn. The page calls this fire and forget
   so model latency never blocks the view. A visitor who pastes their own
   Pollinations key gets a smarter opponent, paid with their own Pollen; with
   no key the opponent uses the keyless text endpoint and falls back to a
   procedural sketch when that free tier throttles. */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const auth = String((req.headers && req.headers.authorization) || "");
  let bearer = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  if (!bearer && typeof body.bearer === "string") bearer = body.bearer;
  if (bearer.indexOf("bot-") === 0 || bearer.length > 400) bearer = "";

  try {
    const moved = await BOT.step(bearer);
    return res.status(200).json({ moved: Boolean(moved) });
  } catch (e) {
    return res.status(200).json({ moved: false, error: String((e && e.message) || e) });
  }
};
