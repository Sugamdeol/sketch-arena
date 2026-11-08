/* Sketch Arena rules: matches, rounds, the canvas and the guess check.

   Pure functions over a plain document, no network and no clock of its own
   except Date.now(), so the whole game can be replayed in a test. */

"use strict";

const WORDS = [
  "anchor", "bicycle", "bridge", "cactus", "camera", "castle", "candle", "clock",
  "comet", "desert", "dolphin", "dragon", "engine", "forest", "guitar", "harbor",
  "helmet", "iceberg", "island", "jacket", "kettle", "ladder", "lantern", "lighthouse",
  "magnet", "mermaid", "mirror", "monkey", "mountain", "octopus", "penguin", "piano",
  "pirate", "planet", "pretzel", "rainbow", "rocket", "saddle", "sandwich", "satellite",
  "spider", "submarine", "teapot", "telescope", "tornado", "tractor", "treasure", "umbrella",
  "volcano", "windmill"
];

const ROUND_MS = Number(process.env.ROUND_MS || 90000);
const BETWEEN_MS = Number(process.env.BETWEEN_MS || 5000);
const IDLE_MS = 15 * 60 * 1000;
const MAX_SHAPES = 48;
const MAX_PLAYERS = 8;

function emptyDoc() {
  return { version: 1, matches: {} };
}

function newMatch(id) {
  const t = Date.now();
  return {
    id: id,
    createdAt: t,
    updatedAt: t,
    status: "lobby",
    roundNo: 0,
    word: null,
    drawer: null,
    players: [],
    shapes: [],
    guesses: [],
    roundLog: [],
    deadline: 0,
    nextRoundAt: 0,
    lastCaption: ""
  };
}

function ensureMatch(doc, id) {
  const key = String(id || "arena").slice(0, 32);
  if (!doc.matches[key]) doc.matches[key] = newMatch(key);
  return doc.matches[key];
}

function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* A guess lands when it names the word, including one typo on longer words. */
function isCorrect(guess, word) {
  const g = norm(guess), w = norm(word);
  if (!g || !w) return false;
  if (g === w) return true;
  const parts = g.split(" ");
  for (const t of parts) {
    if (t === w) return true;
    if (w.length > 4 && lev(t, w) <= 1) return true;
    if (w.length > 7 && lev(t, w) <= 2) return true;
  }
  return false;
}

function token() {
  let s = "";
  for (let i = 0; i < 8; i += 1) s += Math.floor(Math.random() * 36).toString(36);
  return s + Date.now().toString(36);
}

function join(doc, matchId, name) {
  const m = ensureMatch(doc, matchId);
  if (m.players.length >= MAX_PLAYERS) return { error: "this match is full, join with another match id" };
  const clean = String(name || "").replace(/[^\w \-.]/g, "").trim().slice(0, 24);
  if (!clean) return { error: "name is required" };
  const dup = m.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
  if (dup) return { error: "that name is taken in this match, pick another" };
  const p = {
    id: "p" + (m.players.length + 1) + Math.floor(Math.random() * 1000),
    name: clean,
    token: token(),
    score: 0,
    joinedAt: Date.now()
  };
  m.players.push(p);
  m.updatedAt = Date.now();
  return { player: p };
}

function playerByToken(m, t) {
  return m.players.find(p => p.token === t) || null;
}

function playerById(m, id) {
  return m.players.find(p => p.id === id) || null;
}

function pickWord(m) {
  const used = {};
  m.roundLog.forEach(r => { used[r.word] = true; });
  const fresh = WORDS.filter(w => !used[w]);
  const pool = fresh.length ? fresh : WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* A round needs two seats and at least one of them has to be a real player:
   the built in opponent does not play a game against itself. */
function ready(m) {
  return m.players.length >= 2 && m.players.some(p => !p.bot);
}

function startRound(m) {
  if (!ready(m)) { m.status = "lobby"; return m; }
  m.roundNo += 1;
  m.status = "playing";
  m.word = pickWord(m);
  m.shapes = [];
  m.guesses = [];
  m.deadline = Date.now() + ROUND_MS;
  m.nextRoundAt = 0;
  m.drawer = m.players[(m.roundNo - 1) % m.players.length].id;
  m.updatedAt = Date.now();
  return m;
}

/* Close the round that is running and open the gap before the next one. */
function endRound(m, winner) {
  const d = playerById(m, m.drawer);
  m.roundLog.unshift({
    round: m.roundNo,
    word: m.word,
    drawer: d ? d.name : "nobody",
    winner: winner || "nobody",
    at: Date.now()
  });
  if (m.roundLog.length > 12) m.roundLog.length = 12;
  m.status = "between";
  m.nextRoundAt = Date.now() + BETWEEN_MS;
  m.deadline = 0;
  m.updatedAt = Date.now();
  return m;
}

/* Everything that reads the match calls this first, so a round closes even
   when nobody is polling. A match that nobody has touched for 15 minutes is
   wound back to the lobby, which keeps the arena from fossilising around
   agents that left long ago. */
function tick(m) {
  if (!m) return m;
  if (m.players.length && Date.now() - m.updatedAt > IDLE_MS) {
    m.players = [];
    m.roundLog = [];
    m.shapes = [];
    m.guesses = [];
    m.roundNo = 0;
    m.word = null;
    m.drawer = null;
    m.status = "lobby";
    m.updatedAt = Date.now();
    return m;
  }
  if (m.status === "lobby" && ready(m)) startRound(m);
  if (m.status === "playing" && m.deadline && Date.now() > m.deadline) endRound(m, "nobody (time ran out)");
  if (m.status === "between" && m.nextRoundAt && Date.now() >= m.nextRoundAt) startRound(m);
  return m;
}

function num(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/* The canvas is a 0..100 square, so a model that invents coordinates still
   lands inside the picture instead of drawing off screen. */
function cleanShape(s) {
  if (!s || typeof s !== "object") return null;
  const t = String(s.type || "").toLowerCase();
  if (t === "circle" || t === "dot") {
    return { type: "circle", x: num(s.x, 0, 100, 50), y: num(s.y, 0, 100, 50), r: num(s.r, 1, 45, 6) };
  }
  if (t === "rect" || t === "box") {
    return { type: "rect", x: num(s.x, 0, 100, 20), y: num(s.y, 0, 100, 20), w: num(s.w, 1, 100, 25), h: num(s.h, 1, 100, 18) };
  }
  if (t === "line") {
    return { type: "line", x1: num(s.x1, 0, 100, 0), y1: num(s.y1, 0, 100, 0), x2: num(s.x2, 0, 100, 100), y2: num(s.y2, 0, 100, 100) };
  }
  if (t === "path") {
    const d = String(s.d || "").replace(/[^0-9MLCQZmlcqz\s.,-]/g, "").slice(0, 400).trim();
    return d ? { type: "path", d: d } : null;
  }
  return null;
}

function addShapes(m, tokenValue, shapes) {
  const p = playerByToken(m, tokenValue);
  if (!p) return { error: "unknown token, join the match first" };
  if (m.status !== "playing") return { error: "no round is running right now" };
  if (p.id !== m.drawer) return { error: "only the drawer can draw this round" };
  if (!Array.isArray(shapes) || !shapes.length) return { error: "shapes must be a non empty array" };
  if (m.shapes.length >= MAX_SHAPES) return { error: "the canvas is full (" + MAX_SHAPES + " shapes), it is time to guess" };
  const kept = [];
  for (const s of shapes) {
    if (m.shapes.length + kept.length >= MAX_SHAPES) break;
    const c = cleanShape(s);
    if (c) kept.push(c);
  }
  if (!kept.length) return { error: "none of those shapes were usable, see the shape reference" };
  m.shapes = m.shapes.concat(kept);
  m.updatedAt = Date.now();
  return { added: kept.length, total: m.shapes.length };
}

function guess(m, tokenValue, text) {
  const p = playerByToken(m, tokenValue);
  if (!p) return { error: "unknown token, join the match first" };
  if (m.status !== "playing") return { error: "no round is running right now" };
  if (p.id === m.drawer) return { error: "the drawer cannot guess a word they already know" };
  const body = String(text || "").slice(0, 80);
  if (!norm(body)) return { error: "guess is empty" };
  const ok = isCorrect(body, m.word);
  m.guesses.push({ player: p.name, text: body, correct: ok, at: Date.now() });
  if (m.guesses.length > 40) m.guesses.shift();
  let ended = null;
  if (ok) {
    p.score += 2;
    const d = playerById(m, m.drawer);
    if (d) d.score += 1;
    endRound(m, p.name);
    ended = p.name + " guessed it";
  }
  m.updatedAt = Date.now();
  return { correct: ok, ended: ended };
}

function pass(m, tokenValue) {
  const p = playerByToken(m, tokenValue);
  if (!p) return { error: "unknown token, join the match first" };
  if (m.status !== "playing") return { error: "no round is running right now" };
  if (p.id !== m.drawer) return { error: "only the drawer can pass the turn" };
  endRound(m, "nobody (drawer passed)");
  return { ended: true };
}

function leaderboard(m) {
  return m.players
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(p => ({ name: p.name, score: p.score }));
}

function shapeLine(s) {
  if (s.type === "circle") return "circle at (" + s.x + "," + s.y + ") r" + s.r;
  if (s.type === "rect") return "rect at (" + s.x + "," + s.y + ") " + s.w + "x" + s.h;
  if (s.type === "line") return "line (" + s.x1 + "," + s.y1 + ") to (" + s.x2 + "," + s.y2 + ")";
  return "path " + s.d;
}

function secondsLeft(m) {
  if (m.status !== "playing" || !m.deadline) return 0;
  return Math.max(0, Math.round((m.deadline - Date.now()) / 1000));
}

module.exports = {
  WORDS, ROUND_MS, BETWEEN_MS, MAX_SHAPES, MAX_PLAYERS,
  emptyDoc, newMatch, ensureMatch, join, playerByToken, playerById, startRound,
  endRound, tick, addShapes, cleanShape, guess, pass, leaderboard, shapeLine,
  secondsLeft, isCorrect, norm, ready
};
