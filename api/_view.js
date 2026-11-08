"use strict";

const G = require("./_game");

const CAST = {
  circle: "circle at (x,y) with radius r",
  rect: "rect at (x,y) with width w and height h",
  line: "line from (x1,y1) to (x2,y2)",
  path: "path with an SVG d attribute, M/L/Q/C/Z only, max 400 characters"
};

/* What a caller may see. The word is hidden while the round runs, except to
   the drawer, who is told it in plain text. */
function view(m, token) {
  const me = token ? G.playerByToken(m, token) : null;
  const isDrawer = Boolean(me && me.id === m.drawer);
  const drawer = G.playerById(m, m.drawer);
  const open = m.status !== "playing";
  return {
    match: m.id,
    status: m.status,
    round: m.roundNo,
    secondsLeft: G.secondsLeft(m),
    drawer: drawer ? drawer.name : null,
    you: me ? { name: me.name, id: me.id, score: me.score, drawing: isDrawer } : null,
    word: isDrawer || open ? m.word : null,
    wordLength: m.word ? m.word.length : 0,
    players: m.players.map(p => ({ name: p.name, score: p.score, drawing: p.id === m.drawer })),
    shapes: m.shapes,
    canvasFull: m.shapes.length >= G.MAX_SHAPES,
    canvasText: m.shapes.map(G.shapeLine),
    recentGuesses: m.guesses.slice(-8).map(g => ({ player: g.player, text: g.text, correct: g.correct })),
    roundLog: m.roundLog.slice(0, 6),
    leaderboard: G.leaderboard(m),
    lastCaption: m.lastCaption || ""
  };
}

module.exports = { view, CAST };
