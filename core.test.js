"use strict";

const test = require("node:test");
const assert = require("node:assert");
const G = require("./api/_game");

function fresh() { return G.emptyDoc(); }

test("two players start a round automatically", () => {
  const doc = fresh();
  const a = G.join(doc, "arena", "ada");
  assert.ok(a.player && a.player.token);
  const m = G.ensureMatch(doc, "arena");
  assert.equal(m.status, "lobby");
  G.join(doc, "arena", "bob");
  G.tick(m);
  assert.equal(m.status, "playing");
  assert.equal(m.roundNo, 1);
  assert.ok(G.WORDS.includes(m.word));
});

test("duplicate names and blank names are refused", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  assert.match(G.join(doc, "arena", "ADA").error, /taken/);
  assert.match(G.join(doc, "arena", "   ").error, /required/);
});

test("the drawer alone may draw, and shapes are clamped to the canvas", () => {
  const doc = fresh();
  const a = G.join(doc, "arena", "ada").player;
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const drawer = G.playerById(m, m.drawer);
  const other = m.players.find(p => p.id !== m.drawer);
  assert.match(G.addShapes(m, other.token, [{ type: "circle", x: 5, y: 5 }]).error, /only the drawer/);
  const r = G.addShapes(m, drawer.token, [
    { type: "circle", x: -40, y: 900, r: 900 },
    { type: "rect", x: 10, y: 10, w: 30, h: 20 },
    { type: "line", x1: 0, y1: 0, x2: 100, y2: 100 },
    { type: "path", d: "M10 10 L20 20" },
    { type: "junk" }
  ]);
  assert.equal(r.added, 4);
  assert.equal(m.shapes.length, 4);
  assert.equal(m.shapes[0].x, 0);
  assert.equal(m.shapes[0].y, 100);
  assert.equal(m.shapes[0].r, 45);
});

test("a correct guess ends the round and scores both players", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const drawer = G.playerById(m, m.drawer);
  const guesser = m.players.find(p => p.id !== m.drawer);
  assert.match(G.guess(m, drawer.token, "anything").error, /drawer cannot guess/);
  const wrong = G.guess(m, guesser.token, "definitely not the word");
  assert.equal(wrong.correct, false);
  assert.equal(m.status, "playing");
  const right = G.guess(m, guesser.token, m.word.toUpperCase());
  assert.equal(right.correct, true);
  assert.equal(m.status, "between");
  assert.equal(guesser.score, 2);
  assert.equal(drawer.score, 1);
  assert.equal(m.roundLog[0].winner, guesser.name);
});

test("one typo on a long word still counts, short words need exact", () => {
  assert.equal(G.isCorrect("lighthous", "lighthouse"), true);
  assert.equal(G.isCorrect("lighthosue", "lighthouse"), true, "one swap on a long word is forgiven");
  assert.equal(G.isCorrect("lamp", "lighthouse"), false);
  assert.equal(G.isCorrect("cat", "cut"), false);
  assert.equal(G.isCorrect("umbrella!", "umbrella"), true);
});

test("the round times out and the next one opens", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  assert.equal(m.status, "playing");
  m.deadline = Date.now() - 1;
  G.tick(m);
  assert.equal(m.status, "between");
  assert.equal(m.roundLog[0].winner, "nobody (time ran out)");
  m.nextRoundAt = Date.now() - 1;
  G.tick(m);
  assert.equal(m.status, "playing");
  assert.equal(m.roundNo, 2);
});

test("the drawer rotates and words do not repeat until the list is used", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const first = m.drawer;
  G.endRound(m, "nobody");
  m.nextRoundAt = Date.now() - 1;
  G.tick(m);
  assert.notEqual(m.drawer, first);
  assert.equal(m.roundLog.length, 1);
});

test("the word is hidden from the guesser while the round runs", () => {
  const V = require("./api/_view");
  const doc = fresh();
  const a = G.join(doc, "arena", "ada").player;
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const drawer = G.playerById(m, m.drawer);
  const other = m.players.find(p => p.id !== m.drawer);
  const asDrawer = V.view(m, drawer.token);
  const asOther = V.view(m, other.token);
  assert.equal(asDrawer.word, m.word);
  assert.equal(asOther.word, null);
  assert.equal(asOther.wordLength, m.word.length);
  assert.equal(V.view(m, null).word, null);
  assert.equal(asOther.you.name, other.name);
  assert.equal(asOther.drawer, drawer.name);
});

test("a match nobody has touched for 15 minutes reopens as an empty lobby", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  assert.equal(m.status, "playing");
  m.updatedAt = Date.now() - 16 * 60 * 1000;
  G.tick(m);
  assert.equal(m.status, "lobby");
  assert.equal(m.players.length, 0);
  assert.equal(m.roundNo, 0);
});

test("a stroke drawn as a path is stored and read back as text", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const drawer = G.playerById(m, m.drawer);
  G.addShapes(m, drawer.token, [{ type: "path", d: "M10 10 L40 40 L40 10" }]);
  assert.match(G.shapeLine(m.shapes[0]), /^path M10 10 L40 40/);
});

test("the canvas has a hard ceiling so a model cannot flood it", () => {
  const doc = fresh();
  G.join(doc, "arena", "ada");
  G.join(doc, "arena", "bob");
  const m = G.ensureMatch(doc, "arena");
  G.tick(m);
  const drawer = G.playerById(m, m.drawer);
  const many = [];
  for (let i = 0; i < 60; i += 1) many.push({ type: "circle", x: i, y: i });
  const r = G.addShapes(m, drawer.token, many);
  assert.equal(r.added, G.MAX_SHAPES);
  assert.equal(m.shapes.length, G.MAX_SHAPES);
  assert.match(G.addShapes(m, drawer.token, many).error, /canvas is full/);
});
