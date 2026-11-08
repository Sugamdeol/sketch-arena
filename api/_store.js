/* The match document is one row in a Postgres table, reached through
   PostgREST. One row means every write is a compare and swap on a `rev`
   counter: the PATCH names the rev it read, so a write that arrives late
   updates 0 rows and retries on fresh state instead of overwriting somebody
   else's drawing. That is what makes several agents drawing at the same
   moment safe without a server-side lock.

   With no env vars set the same code runs on a module variable, so
   `node dev.js` plays a full match with no database at all. */

"use strict";

const G = require("./_game");

const TABLE = "sketch_stadium";
const ROW = "arena";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_KEY || "";
const remote = Boolean(URL_BASE && KEY);

const memo = { doc: G.emptyDoc(), rev: -1 };

function headers(extra) {
  return Object.assign({
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    "Content-Type": "application/json",
    Accept: "application/json"
  }, extra || {});
}

async function read() {
  const r = await fetch(URL_BASE + "/rest/v1/" + TABLE + "?id=eq." + ROW + "&select=doc,rev", { headers: headers() });
  if (!r.ok) throw new Error("store read failed: HTTP " + r.status + " " + (await r.text()).slice(0, 140));
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function insert(doc) {
  const r = await fetch(URL_BASE + "/rest/v1/" + TABLE, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify({ id: ROW, doc: doc, rev: 1 })
  });
  if (!r.ok) throw new Error("store insert failed: HTTP " + r.status + " " + (await r.text()).slice(0, 140));
  const rows = await r.json();
  return rows.length ? rows[0].rev : 1;
}

async function swap(doc, rev) {
  const r = await fetch(URL_BASE + "/rest/v1/" + TABLE + "?id=eq." + ROW + "&rev=eq." + rev, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify({ doc: doc, rev: rev + 1 })
  });
  if (!r.ok) throw new Error("store write failed: HTTP " + r.status + " " + (await r.text()).slice(0, 140));
  const rows = await r.json();
  return rows.length ? rows[0].rev : null;
}

/* mutate(doc) returns { doc, result }. Runs up to five times if other
   players keep winning the swap. */
async function withDoc(mutate) {
  if (!remote) {
    const out = mutate(memo.doc);
    memo.doc = out.doc;
    memo.rev += 1;
    return out.result;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await read();
    if (!row) {
      const out = mutate(G.emptyDoc());
      try {
        await insert(out.doc);
        return out.result;
      } catch (e) {
        continue;
      }
    }
    const out = mutate(row.doc);
    const rev = await swap(out.doc, row.rev);
    if (rev !== null) return out.result;
  }
  throw new Error("the match was busy, try again");
}

module.exports = { withDoc, remote: () => remote, TABLE };
