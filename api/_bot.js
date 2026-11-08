/* The house opponent.

   Polli fills the second seat, so a person who opens the page always has
   someone to play against and a single agent that connects over MCP still
   sees a live match. Its moves come from a Pollinations text model, one small
   call per turn, capped per round and spaced out. When the model is slow,
   throttled or answers nonsense the opponent still sketches something
   procedural and guesses a word of the right length, so a round can never
   stall on the network.

   Model work happens OUTSIDE the document lock: read a snapshot, decide, then
   write only if that round is still the current one. Ten seconds of latency
   therefore never holds the match for other players. */

"use strict";

const G = require("./_game");
const S = require("./_store");

const KEYED_URL = "https://gen.pollinations.ai/v1/chat/completions";
const FREE_URL = "https://text.pollinations.ai/openai";
const POLL_KEY = process.env.POLL_KEY || "";
const MODEL = process.env.BOT_MODEL || "openai";
const MIN_GAP_MS = 4000;
const TIMEOUT_MS = 12000;
const MAX_CALLS_PER_ROUND = 6;
const MAX_GUESSES_PER_ROUND = 3;

const DRAW_SYSTEM = [
  "You are Polli, a player in a drawing game. You draw a word using only geometric shapes.",
  "Answer with a JSON array only. No prose, no markdown fences.",
  "Shapes:",
  '{"type":"circle","x":0-100,"y":0-100,"r":1-45}',
  '{"type":"rect","x":0-100,"y":0-100,"w":1-100,"h":1-100}',
  '{"type":"line","x1":0-100,"y1":0-100,"x2":0-100,"y2":0-100}',
  '{"type":"path","d":"M10 10 L40 40"}',
  "The canvas is a square from 0 to 100, origin top left. Use 6 to 10 shapes.",
  "Sketch it the way a person would: the main outline first, then the two or three details that make the word unmistakable."
].join(" ");

const GUESS_SYSTEM = [
  "You are Polli, a player in a drawing game. The drawing is described to you as a list of shapes on a 0 to 100 square, origin top left.",
  "Answer with one word: the thing being drawn. Lowercase, no sentence, no punctuation, no explanation."
].join(" ");

function botPlayer(m) {
  return m.players.find(p => p.bot) || null;
}

async function ask(system, user, maxTokens, bearer) {
  const key = bearer || POLL_KEY;
  const url = key ? KEYED_URL : FREE_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;
    const r = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0.8
      }),
      signal: ctrl.signal
    });
    if (!r.ok) return null;
    const d = await r.json();
    const msg = d && d.choices && d.choices[0] && d.choices[0].message;
    if (!msg) return null;
    let c = msg.content;
    if (Array.isArray(c)) c = c.map(p => (typeof p === "string" ? p : (p && p.text) || "")).join(" ");
    return String(c || "").trim() || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseShapes(text) {
  if (!text) return [];
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a === -1 || b <= a) return [];
  let list;
  try { list = JSON.parse(text.slice(a, b + 1)); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list.slice(0, 12)) {
    const c = G.cleanShape(raw);
    if (c) out.push(c);
  }
  return out;
}

/* Deterministic shapes for a word, so a failed model call still leaves a
   picture that reads as something rather than a blank canvas. */
function fallbackDrawing(word) {
  const seed = String(word).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const shapes = [
    { type: "rect", x: 24, y: 50, w: 52, h: 28 },
    { type: "line", x1: 24, y1: 50, x2: 50, y2: 28 },
    { type: "line", x1: 76, y1: 50, x2: 50, y2: 28 },
    { type: "line", x1: 24, y1: 78, x2: 76, y2: 78 }
  ];
  const n = seed % 3;
  for (let i = 0; i <= n; i += 1) shapes.push({ type: "circle", x: 36 + i * 12, y: 62, r: 3.5 });
  shapes.push({ type: "path", d: "M26 86 L50 92 L74 86" });
  return shapes;
}

function cleanGuess(text) {
  if (!text) return "";
  const w = String(text).toLowerCase().replace(/[^a-z ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return w.length ? w[w.length - 1] : "";
}

/* A word the bot has not already said this round, preferring the right
   length, so a repeated guess never clutters the board. */
function freshGuess(wordLength, already) {
  const said = {};
  (already || []).forEach(g => { said[String(g).toLowerCase()] = true; });
  const same = G.WORDS.filter(w => !said[w] && w.length === wordLength);
  const any = G.WORDS.filter(w => !said[w]);
  const pick = same.length ? same : any;
  return pick.length ? pick[Math.floor(Math.random() * pick.length)] : "";
}

/* Decide, then write. Returns true when the match changed. */
async function step(bearer) {
  const act = await S.withDoc(doc => {
    const m = G.ensureMatch(doc, "arena");
    const before = JSON.stringify(m);
    G.tick(m);
    const bot = botPlayer(m);
    const due = bot && m.status === "playing" ? dueNow(m, bot) : null;
    return { doc: doc, result: { changed: before !== JSON.stringify(m), act: due } };
  });
  if (!act.act) return act.changed;
  const turn = act.act;

  let shapes = [];
  let guess = "";
  if (turn.drawing) {
    const text = await ask(DRAW_SYSTEM, 'Draw the word: "' + turn.word + '". Reply with the JSON array only.', 600, bearer);
    shapes = parseShapes(text);
    if (!shapes.length) shapes = fallbackDrawing(turn.word);
  } else {
    const text = await ask(GUESS_SYSTEM, "A " + turn.wordLength + " letter word. Shapes: " + turn.shapes + ". Answer with one word.", 24, bearer);
    guess = cleanGuess(text);
    if (!guess || turn.said.indexOf(guess) !== -1) guess = freshGuess(turn.wordLength, turn.said);
    if (!guess) return true;
  }

  return S.withDoc(doc => {
    const m = G.ensureMatch(doc, "arena");
    G.tick(m);
    if (m.status !== "playing" || m.roundNo !== turn.round) return { doc: doc, result: true };
    if (turn.drawing) {
      for (const s of shapes) {
        if (m.shapes.length >= G.MAX_SHAPES) break;
        m.shapes.push(s);
      }
    } else {
      G.guess(m, turn.botToken, guess);
    }
    G.tick(m);
    m.updatedAt = Date.now();
    return { doc: doc, result: true };
  });
}

/* What the bot may do right now, plus the throttle. No network in here. */
function dueNow(m, bot) {
  if (m.botRound !== m.roundNo) { m.botRound = m.roundNo; m.botCalls = 0; m.botGuesses = 0; }
  if ((m.botCalls || 0) >= MAX_CALLS_PER_ROUND) return null;
  if (Date.now() - (m.botAt || 0) < MIN_GAP_MS) return null;
  const drawing = bot.id === m.drawer;
  if (drawing ? m.shapes.length >= 6 : m.shapes.length < 2) return null;
  if (!drawing && (m.botGuesses || 0) >= MAX_GUESSES_PER_ROUND) return null;
  m.botAt = Date.now();
  m.botCalls = (m.botCalls || 0) + 1;
  if (!drawing) m.botGuesses = (m.botGuesses || 0) + 1;
  return {
    round: m.roundNo,
    botToken: bot.token,
    drawing: drawing,
    word: drawing ? m.word : null,
    wordLength: m.word ? m.word.length : 0,
    shapes: m.shapes.map(G.shapeLine).join("; ").slice(0, 700),
    said: m.guesses.filter(g => g.player === bot.name).map(g => String(g.text).toLowerCase())
  };
}

/* Keep one bot seat in the match, so anyone who shows up has an opponent. */
function seat(m) {
  if (botPlayer(m)) return m;
  if (m.players.length >= G.MAX_PLAYERS) return m;
  let name = "Polli";
  for (let i = 2; m.players.some(p => p.name.toLowerCase() === name.toLowerCase()); i += 1) name = "Polli " + i;
  m.players.push({ id: "bot-" + name, name: name, token: "bot-" + name, score: 0, bot: true, joinedAt: Date.now() });
  m.updatedAt = Date.now();
  return m;
}

module.exports = { step, seat, botPlayer, parseShapes, fallbackDrawing, cleanGuess, freshGuess, hasKey: () => Boolean(POLL_KEY) };
