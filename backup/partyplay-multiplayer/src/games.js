// Game engine definitions for PartyPlay.
//
// Each game exposes a common interface used by the room orchestrator in
// server.js. There are three "modes" that drive how the client renders and
// how submissions are scored:
//
//   - "quiz"     : a prompt with multiple options; first/only answer counts.
//                  Scoring rewards correctness + speed (Kahoot style).
//   - "reaction" : wait for a random GO signal then tap as fast as possible.
//                  Scoring rewards low reaction time; tapping early = 0.
//   - "tap"      : tap as many times as you can before time runs out.
//                  Scoring rewards raw tap count.
//
// A game definition provides:
//   id, name, emoji, color, description, mode, rounds, roundDuration (ms)
//   prepare(roundIndex)  -> roundDef  (server-only full definition w/ answer)
//   hostView(roundDef)   -> object shown on the host screen
//   playerView(roundDef) -> object shown on each player's phone
//   score(roundDef, submission) -> { correct: bool, points: number, ... }

const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Standard speed-aware score: full points for instant correct answers,
// decaying to half points as the clock runs out. Wrong = 0.
function speedScore(elapsedMs, maxMs, base = 1000) {
  const frac = Math.max(0, Math.min(1, elapsedMs / maxMs));
  return Math.round(base * (1 - frac * 0.5));
}

/* ------------------------------------------------------------------ */
/* Trivia Quiz                                                         */
/* ------------------------------------------------------------------ */

const TRIVIA_BANK = [
  { q: "Which planet is known as the Red Planet?", a: ["Mars", "Venus", "Jupiter", "Saturn"], correct: 0 },
  { q: "What is the largest mammal in the world?", a: ["Elephant", "Blue Whale", "Giraffe", "Hippo"], correct: 1 },
  { q: "How many continents are there on Earth?", a: ["5", "6", "7", "8"], correct: 2 },
  { q: "Which language has the most native speakers?", a: ["English", "Hindi", "Spanish", "Mandarin Chinese"], correct: 3 },
  { q: "What is the chemical symbol for gold?", a: ["Au", "Ag", "Gd", "Go"], correct: 0 },
  { q: "Who painted the Mona Lisa?", a: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], correct: 1 },
  { q: "Which ocean is the largest?", a: ["Atlantic", "Indian", "Pacific", "Arctic"], correct: 2 },
  { q: "How many bones are in the adult human body?", a: ["186", "201", "215", "206"], correct: 3 },
  { q: "What gas do plants absorb from the atmosphere?", a: ["Carbon Dioxide", "Oxygen", "Nitrogen", "Helium"], correct: 0 },
  { q: "Which country is home to the kangaroo?", a: ["India", "Australia", "Brazil", "Kenya"], correct: 1 },
  { q: "What is the capital of Japan?", a: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correct: 2 },
  { q: "How many sides does a hexagon have?", a: ["5", "7", "8", "6"], correct: 3 },
  { q: "Which element has the symbol 'O'?", a: ["Oxygen", "Osmium", "Gold", "Oganesson"], correct: 0 },
  { q: "What is the fastest land animal?", a: ["Lion", "Cheetah", "Horse", "Greyhound"], correct: 1 },
  { q: "In which year did humans first land on the Moon?", a: ["1959", "1965", "1969", "1972"], correct: 2 },
  { q: "What is the hardest natural substance on Earth?", a: ["Iron", "Quartz", "Titanium", "Diamond"], correct: 3 },
  { q: "Which is the smallest prime number?", a: ["2", "1", "3", "0"], correct: 0 },
  { q: "What do bees collect to make honey?", a: ["Water", "Nectar", "Pollen only", "Sap"], correct: 1 },
  { q: "Which planet has the most moons?", a: ["Earth", "Mars", "Saturn", "Mercury"], correct: 2 },
  { q: "What is the freezing point of water in Celsius?", a: ["32", "10", "-5", "0"], correct: 3 },
];

const triviaGame = {
  id: "trivia",
  name: "Trivia Quiz",
  emoji: "🧠",
  color: "#7c3aed",
  description: "Answer general-knowledge questions. Fast + correct wins big.",
  mode: "quiz",
  rounds: 6,
  roundDuration: 15000,
  winTarget: 3000,
  prepare(roundIndex, deck) {
    // deck: a per-game shuffled list of indices so questions don't repeat.
    const item = TRIVIA_BANK[deck[roundIndex % deck.length]];
    const order = shuffle([0, 1, 2, 3]);
    const options = order.map((i) => item.a[i]);
    const correctIndex = order.indexOf(item.correct);
    return { prompt: item.q, options, correctIndex };
  },
  hostView(r) {
    return { prompt: r.prompt, options: r.options };
  },
  playerView(r) {
    return { prompt: r.prompt, options: r.options };
  },
  score(r, sub) {
    const correct = sub.answer === r.correctIndex;
    return { correct, points: correct ? speedScore(sub.elapsedMs, this.roundDuration) : 0 };
  },
};

/* ------------------------------------------------------------------ */
/* Math Blitz                                                          */
/* ------------------------------------------------------------------ */

const mathGame = {
  id: "math",
  name: "Math Blitz",
  emoji: "➗",
  color: "#0ea5e9",
  description: "Solve arithmetic faster than everyone else.",
  mode: "quiz",
  rounds: 7,
  roundDuration: 10000,
  winTarget: 3200,
  prepare(roundIndex) {
    const ops = ["+", "-", "×"];
    const level = Math.min(roundIndex, 4);
    const max = 10 + level * 8;
    const op = ops[rand(ops.length)];
    let x = rand(max) + 1;
    let y = rand(max) + 1;
    let answer;
    if (op === "+") answer = x + y;
    else if (op === "-") {
      if (y > x) [x, y] = [y, x];
      answer = x - y;
    } else {
      x = rand(9) + 2;
      y = rand(9) + 2;
      answer = x * y;
    }
    // Build 4 plausible options.
    const opts = new Set([answer]);
    while (opts.size < 4) {
      const delta = rand(9) - 4 || 5;
      const cand = answer + delta;
      if (cand >= 0) opts.add(cand);
    }
    const options = shuffle([...opts]);
    return {
      prompt: `${x} ${op} ${y} = ?`,
      options: options.map(String),
      correctIndex: options.indexOf(answer),
    };
  },
  hostView(r) {
    return { prompt: r.prompt, options: r.options };
  },
  playerView(r) {
    return { prompt: r.prompt, options: r.options };
  },
  score(r, sub) {
    const correct = sub.answer === r.correctIndex;
    return { correct, points: correct ? speedScore(sub.elapsedMs, this.roundDuration) : 0 };
  },
};

/* ------------------------------------------------------------------ */
/* Color Trap (Stroop test)                                            */
/* ------------------------------------------------------------------ */

const COLORS = [
  { name: "RED", hex: "#ef4444" },
  { name: "BLUE", hex: "#3b82f6" },
  { name: "GREEN", hex: "#22c55e" },
  { name: "YELLOW", hex: "#eab308" },
  { name: "PURPLE", hex: "#a855f7" },
  { name: "ORANGE", hex: "#f97316" },
];

const colorGame = {
  id: "color",
  name: "Color Trap",
  emoji: "🎨",
  color: "#f43f5e",
  description: "Pick the INK color of the word, not what it says. Tricky!",
  mode: "quiz",
  rounds: 7,
  roundDuration: 8000,
  winTarget: 3000,
  prepare() {
    const pool = shuffle(COLORS);
    const wordColor = pool[0]; // the meaning of the word
    let inkColor = pool[1]; // the color it's printed in (the answer)
    // 30% of the time, make word & ink match for variety.
    if (Math.random() < 0.3) inkColor = wordColor;
    const optionColors = shuffle(COLORS).slice(0, 4);
    if (!optionColors.find((c) => c.name === inkColor.name)) optionColors[0] = inkColor;
    const options = shuffle(optionColors);
    return {
      word: wordColor.name,
      inkHex: inkColor.hex,
      options: options.map((c) => ({ name: c.name, hex: c.hex })),
      correctIndex: options.findIndex((c) => c.name === inkColor.name),
    };
  },
  hostView(r) {
    return { word: r.word, inkHex: r.inkHex, options: r.options };
  },
  playerView(r) {
    return { word: r.word, inkHex: r.inkHex, options: r.options };
  },
  score(r, sub) {
    const correct = sub.answer === r.correctIndex;
    return { correct, points: correct ? speedScore(sub.elapsedMs, this.roundDuration) : 0 };
  },
};

/* ------------------------------------------------------------------ */
/* Reaction Rush                                                       */
/* ------------------------------------------------------------------ */

const reactionGame = {
  id: "reaction",
  name: "Reaction Rush",
  emoji: "⚡",
  color: "#f59e0b",
  description: "Wait for GREEN, then tap as fast as you can. Don't jump early!",
  mode: "reaction",
  rounds: 4,
  roundDuration: 6000, // window AFTER go signal to record taps
  winTarget: 2400,
  prepare() {
    // Random delay before the GO signal (1.5s - 5s).
    return { goDelay: 1500 + rand(3500) };
  },
  hostView() {
    return {};
  },
  playerView() {
    return {};
  },
  // For reaction, submission.reactionMs is time from GO to tap (or null/early).
  score(r, sub) {
    if (sub.early) return { correct: false, points: 0, reactionMs: null, early: true };
    if (sub.reactionMs == null) return { correct: false, points: 0, reactionMs: null };
    // 120ms reaction ~ 1000pts, 600ms ~ 480pts, scale linearly, floor 50.
    const points = Math.max(50, Math.round(1000 - (sub.reactionMs - 120) * 1.3));
    return { correct: true, points: Math.min(1000, points), reactionMs: sub.reactionMs };
  },
};

/* ------------------------------------------------------------------ */
/* Tap Battle                                                          */
/* ------------------------------------------------------------------ */

const tapGame = {
  id: "tap",
  name: "Tap Battle",
  emoji: "👆",
  color: "#10b981",
  description: "Tap the button as many times as possible before time's up!",
  mode: "tap",
  rounds: 3,
  roundDuration: 6000,
  winTarget: 1500,
  prepare() {
    return {};
  },
  hostView() {
    return {};
  },
  playerView() {
    return {};
  },
  // submission.taps = number of taps recorded by the client.
  score(r, sub) {
    const taps = sub.taps || 0;
    // ~63 taps (10.5/sec) caps out at 1000.
    return { correct: taps > 0, points: Math.min(1000, taps * 16), taps };
  },
};

/* ------------------------------------------------------------------ */
/* Arcade games — skill-based, rendered on a canvas on the player's    */
/* phone. The server just streams + scores the raw in-game score.      */
/* ------------------------------------------------------------------ */

function arcadeScore(r, sub) {
  const s = sub.score || 0;
  return { correct: s > 0, points: s, score: s };
}

const raceGame = {
  id: "race",
  name: "Street Racer",
  emoji: "🏎️",
  color: "#ef4444",
  description: "Steer your car and dodge the traffic. Survive longer for more points — one crash ends your run!",
  mode: "arcade",
  rounds: 3,
  roundDuration: 26000,
  winTarget: 600,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

const cricketGame = {
  id: "cricket",
  name: "Power Cricket",
  emoji: "🏏",
  color: "#16a34a",
  description: "Time your shots! Tap as the ball reaches the bat — perfect timing smashes a SIX. Three wickets and you're out.",
  mode: "arcade",
  rounds: 3,
  roundDuration: 28000,
  winTarget: 120,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

const flappyGame = {
  id: "flappy",
  name: "Sky Hopper",
  emoji: "🐤",
  color: "#eab308",
  description: "Tap to fly through the big gaps. Gentle and forgiving — how far can you go?",
  mode: "arcade",
  rounds: 3,
  roundDuration: 30000,
  winTarget: 12,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

const gravityGame = {
  id: "gravity",
  name: "Gravity Run",
  emoji: "🌀",
  color: "#8b5cf6",
  description: "Tap to flip gravity and switch between floor and ceiling. Dodge the blocks as you sprint!",
  mode: "arcade",
  rounds: 3,
  roundDuration: 30000,
  winTarget: 30,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

const stackGame = {
  id: "stack",
  name: "Stack Tower",
  emoji: "🧱",
  color: "#0891b2",
  description: "Tap to drop each moving block. Stack them as high as you can — misalign too far and it topples!",
  mode: "arcade",
  rounds: 3,
  roundDuration: 40000,
  winTarget: 30,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

const brickGame = {
  id: "brick",
  name: "Brick Breaker",
  emoji: "🧊",
  color: "#f97316",
  description: "Slide the paddle to bounce the ball and smash every brick. Don't let it slip past you!",
  mode: "arcade",
  rounds: 3,
  roundDuration: 34000,
  winTarget: 45,
  prepare() { return {}; },
  hostView() { return {}; },
  playerView() { return {}; },
  score: arcadeScore,
};

export const GAMES = [
  triviaGame, mathGame, colorGame, reactionGame, tapGame,
  raceGame, cricketGame, flappyGame, gravityGame, stackGame, brickGame,
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

export function gameCatalog() {
  return GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    color: g.color,
    description: g.description,
    mode: g.mode,
    rounds: g.rounds,
    winTarget: g.winTarget,
  }));
}

export { shuffle };
