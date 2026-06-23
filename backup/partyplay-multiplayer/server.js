import express from "express";
import http from "http";
import { Server } from "socket.io";
import QRCode from "qrcode";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { GAMES, getGame, gameCatalog, shuffle } from "./src/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Friendly routes.
app.get("/host", (_req, res) => res.sendFile(path.join(__dirname, "public", "host.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(__dirname, "public", "play.html")));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// The LAN address so players on the same Wi-Fi can scan & connect.
function getLanIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) return iface.address;
      }
    }
  } catch {
    // Some sandboxed environments block interface enumeration; fall back.
  }
  return process.env.HOST_IP || "localhost";
}
const LAN_IP = getLanIp();

const AVATARS = ["🦊", "🐼", "🐸", "🦁", "🐧", "🐙", "🦄", "🐝", "🐲", "🦉", "🐬", "🦖", "🐳", "🦋", "🐢", "🦜"];

const rooms = new Map(); // code -> Room

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    connected: p.connected,
  }));
}

function leaderboard(room) {
  return publicPlayers(room).sort((a, b) => b.score - a.score);
}

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

/* ------------------------------------------------------------------ */
/* Game orchestration                                                  */
/* ------------------------------------------------------------------ */

function startGame(room, gameId) {
  const game = getGame(gameId);
  if (!game) return;
  room.game = game;
  room.roundIndex = -1;
  room.state = "playing";
  // Per-game shuffled deck of question indices (used by trivia).
  room.deck = shuffle([...Array(20).keys()]);
  // Reset scores for a fresh game.
  for (const p of room.players.values()) p.score = 0;

  io.to(room.code).emit("game:intro", {
    game: { id: game.id, name: game.name, emoji: game.emoji, color: game.color, description: game.description },
    rounds: game.rounds,
    mode: game.mode,
    winTarget: game.winTarget || 0,
    players: publicPlayers(room),
  });

  room.timers.push(setTimeout(() => nextRound(room), 3200));
}

function nextRound(room) {
  const game = room.game;
  room.roundIndex += 1;
  if (room.roundIndex >= game.rounds) return endGame(room);

  const roundDef = game.prepare(room.roundIndex, room.deck);
  room.roundDef = roundDef;
  room.submissions = new Map();
  room.done = new Set();
  room.state = "playing";
  room.roundStart = Date.now();
  room.goAt = null;

  const common = {
    gameId: game.id,
    mode: game.mode,
    round: room.roundIndex + 1,
    totalRounds: game.rounds,
    duration: game.roundDuration,
  };

  // Host gets the full host view; players get the player view.
  io.to(room.hostRoom).emit("round:start", { ...common, view: game.hostView(roundDef) });

  if (game.mode === "reaction") {
    // Tell players to get ready; reveal GO after a random delay.
    io.to(room.playerRoom).emit("round:start", { ...common, view: {}, phase: "wait" });
    room.timers.push(
      setTimeout(() => {
        room.goAt = Date.now();
        io.to(room.code).emit("round:go", { round: room.roundIndex + 1 });
        // End the round a fixed window after GO.
        room.timers.push(setTimeout(() => finishRound(room), game.roundDuration));
      }, roundDef.goDelay)
    );
  } else {
    io.to(room.playerRoom).emit("round:start", { ...common, view: game.playerView(roundDef) });
    // Arcade runs locally on each phone; give a little buffer past the play
    // window for final scores to arrive before we force the round closed.
    const hardLimit = game.mode === "arcade" ? game.roundDuration + 2500 : game.roundDuration;
    room.timers.push(setTimeout(() => finishRound(room), hardLimit));
  }
}

function maybeFinishEarly(room) {
  if (!room.game) return;
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length === 0) return;
  const mode = room.game.mode;
  let done = false;
  if (mode === "quiz") {
    done = active.every((p) => room.submissions.has(p.id));
  } else if (mode === "arcade") {
    // Everyone has crashed/finished their run early → no need to wait.
    done = active.every((p) => room.done.has(p.id));
  }
  if (done) {
    clearTimers(room);
    room.timers.push(setTimeout(() => finishRound(room), 600));
  }
}

function finishRound(room) {
  if (room.state === "results") return;
  clearTimers(room);
  room.state = "results";
  const game = room.game;
  const roundDef = room.roundDef;

  const roundResults = [];
  for (const p of room.players.values()) {
    const sub = room.submissions.get(p.id);
    let result;
    if (!sub) {
      result = { correct: false, points: 0, answered: false };
    } else {
      result = { ...game.score(roundDef, sub), answered: true, raw: sub };
    }
    p.score += result.points;
    roundResults.push({ playerId: p.id, ...result });

    // Personalised result to each player.
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) {
      sock.emit("round:result", {
        correct: result.correct,
        points: result.points,
        totalScore: p.score,
        rank: 0, // filled below
        reactionMs: result.reactionMs ?? null,
        taps: result.raw?.taps ?? null,
        score: result.raw?.score ?? null,
      });
    }
  }

  const board = leaderboard(room);
  const rankById = new Map(board.map((p, i) => [p.id, i + 1]));
  // Send each player their rank.
  for (const p of room.players.values()) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("round:rank", { rank: rankById.get(p.id), total: board.length });
  }

  // Host gets full round breakdown + leaderboard.
  io.to(room.hostRoom).emit("round:result", {
    round: room.roundIndex + 1,
    totalRounds: game.rounds,
    mode: game.mode,
    reveal: revealForHost(game, roundDef, roundResults),
    leaderboard: board,
  });

  const isLast = room.roundIndex + 1 >= game.rounds;
  room.timers.push(setTimeout(() => (isLast ? endGame(room) : nextRound(room)), 4500));
}

function revealForHost(game, roundDef, roundResults) {
  const answered = roundResults.filter((r) => r.answered);
  const base = {
    correctCount: roundResults.filter((r) => r.correct).length,
    answeredCount: answered.length,
  };
  if (game.mode === "quiz") {
    // Distribution of answers across options.
    const dist = (roundDef.options || []).map(() => 0);
    for (const r of roundResults) {
      if (r.answered && typeof r.raw?.answer === "number" && dist[r.raw.answer] != null) dist[r.raw.answer] += 1;
    }
    return { ...base, correctIndex: roundDef.correctIndex, distribution: dist };
  }
  if (game.mode === "reaction") {
    const times = answered.map((r) => r.reactionMs).filter((t) => typeof t === "number");
    return { ...base, bestMs: times.length ? Math.min(...times) : null };
  }
  if (game.mode === "tap") {
    const taps = answered.map((r) => r.raw?.taps || 0);
    return { ...base, bestTaps: taps.length ? Math.max(...taps) : 0 };
  }
  if (game.mode === "arcade") {
    const scores = answered.map((r) => r.raw?.score || 0);
    return { ...base, bestScore: scores.length ? Math.max(...scores) : 0 };
  }
  return base;
}

function endGame(room) {
  clearTimers(room);
  room.state = "gameover";
  const board = leaderboard(room);
  const target = room.game?.winTarget || 0;
  const top = board[0] || null;
  // A winner must finish first AND clear the qualifying target score.
  const qualified = !!(top && top.score >= target);
  io.to(room.code).emit("game:over", {
    winner: qualified ? top : null,
    qualified,
    target,
    topPlayer: top,
    leaderboard: board,
  });
  room.state = "gameover";
  room.game = null;
}

// Resolve the public base URL used for the join link + QR code.
function resolveBaseUrl(origin) {
  const sanitize = (u) => (u || "").replace(/\/+$/, "");
  // Prefer (1) an explicit PUBLIC_URL env var (set in production), then
  // (2) the origin of the host page itself (works on any deployed domain),
  // and finally (3) the detected LAN address for local same-Wi-Fi play.
  return sanitize(process.env.PUBLIC_URL) || sanitize(origin) || `http://${LAN_IP}:${PORT}`;
}

async function buildJoinPayload(room) {
  const joinUrl = `${room.baseUrl}/play?room=${room.code}`;
  let qr = null;
  try {
    qr = await QRCode.toDataURL(joinUrl, { width: 360, margin: 1, color: { dark: "#111827", light: "#ffffff" } });
  } catch {}
  return { joinUrl, qr };
}

/* ------------------------------------------------------------------ */
/* Socket handlers                                                     */
/* ------------------------------------------------------------------ */

io.on("connection", (socket) => {
  // ---- HOST ----
  socket.on("host:create", async (opts = {}) => {
    const code = makeRoomCode();
    const room = {
      code,
      hostSocketId: socket.id,
      hostConnected: true,
      hostGraceTimer: null,
      hostRoom: `${code}:host`,
      playerRoom: `${code}:players`,
      baseUrl: resolveBaseUrl(opts.origin),
      players: new Map(),
      state: "lobby",
      game: null,
      roundIndex: -1,
      roundDef: null,
      submissions: new Map(),
      timers: [],
      deck: [],
    };
    rooms.set(code, room);
    socket.join(code);
    socket.join(room.hostRoom);
    socket.data.role = "host";
    socket.data.roomCode = code;

    const { joinUrl, qr } = await buildJoinPayload(room);
    socket.emit("host:created", {
      code,
      joinUrl,
      qr,
      games: gameCatalog(),
      players: publicPlayers(room),
    });
  });

  // Host page reloaded / reconnected: re-attach to its existing room so a
  // transient network blip or refresh does not destroy an in-progress game.
  socket.on("host:reattach", async ({ code, origin } = {}) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("host:reattachFailed");
      return;
    }
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
    room.hostSocketId = socket.id;
    room.hostConnected = true;
    if (origin) room.baseUrl = resolveBaseUrl(origin);
    socket.join(code);
    socket.join(room.hostRoom);
    socket.data.role = "host";
    socket.data.roomCode = code;
    io.to(room.playerRoom).emit("host:resumed");

    const { joinUrl, qr } = await buildJoinPayload(room);
    socket.emit("host:reattached", {
      code,
      joinUrl,
      qr,
      games: gameCatalog(),
      players: publicPlayers(room),
      state: room.state,
      leaderboard: leaderboard(room),
    });
  });

  socket.on("host:start", ({ gameId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.players.size === 0) {
      socket.emit("host:error", { message: "Need at least one player to start." });
      return;
    }
    startGame(room, gameId);
  });

  socket.on("host:playAgain", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    clearTimers(room);
    room.state = "lobby";
    room.game = null;
    io.to(room.code).emit("lobby:return", { players: publicPlayers(room), games: gameCatalog() });
  });

  // ---- PLAYER ----
  socket.on("player:join", (payload = {}) => {
    const { name, playerId } = payload;
    // Accept the room code under either key for robustness.
    const code = (payload.room || payload.code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("player:joinError", { message: "Room not found. Check the code." });
      return;
    }

    // Reconnect path: same playerId rejoining.
    let player = playerId ? room.players.get(playerId) : null;
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    } else {
      const cleanName = (name || "").trim().slice(0, 14) || "Player";
      const id = `p_${Math.random().toString(36).slice(2, 9)}`;
      const usedAvatars = new Set([...room.players.values()].map((p) => p.avatar));
      const avatar = AVATARS.find((a) => !usedAvatars.has(a)) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
      player = { id, name: cleanName, avatar, score: 0, connected: true, socketId: socket.id };
      room.players.set(id, player);
    }

    socket.join(code);
    socket.join(room.playerRoom);
    socket.data.role = "player";
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    socket.emit("player:joined", {
      playerId: player.id,
      name: player.name,
      avatar: player.avatar,
      code,
      state: room.state,
    });

    io.to(room.code).emit("room:players", { players: publicPlayers(room) });

    // Seamless resume: if a round is already in progress and this player
    // hasn't answered it yet, drop them straight into it with the time that's
    // left (quiz + arcade only; reaction/tap are too short to resume mid-round).
    if (room.state === "playing" && room.game && !room.submissions.has(player.id)) {
      const game = room.game;
      const remaining = Math.max(3000, game.roundDuration - (Date.now() - room.roundStart));
      if (game.mode === "quiz" || game.mode === "arcade") {
        socket.emit("round:start", {
          gameId: game.id,
          mode: game.mode,
          round: room.roundIndex + 1,
          totalRounds: game.rounds,
          duration: remaining,
          view: game.mode === "quiz" ? game.playerView(room.roundDef) : {},
        });
      }
    }
  });

  socket.on("player:submit", (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== "playing" || !room.game) return;
    const player = room.players.get(socket.data.playerId);
    if (!player) return;

    const game = room.game;
    // Quiz/reaction lock after a single answer. Tap/arcade stream updates and
    // must keep accepting submissions until the round ends.
    if ((game.mode === "quiz" || game.mode === "reaction") && room.submissions.has(player.id)) return;

    let sub;
    if (game.mode === "quiz") {
      sub = { answer: payload.answer, elapsedMs: Date.now() - room.roundStart };
    } else if (game.mode === "reaction") {
      if (!room.goAt) {
        sub = { early: true };
      } else {
        sub = { reactionMs: Math.max(0, Date.now() - room.goAt) };
      }
    } else if (game.mode === "tap") {
      // Tap submissions stream in; keep latest count, allow updates.
      const existing = room.submissions.get(player.id);
      sub = { taps: Math.max(payload.taps || 0, existing?.taps || 0) };
      room.submissions.set(player.id, sub);
      return; // don't lock; tap count updates until round ends
    } else if (game.mode === "arcade") {
      // Arcade score streams in; keep the best, mark "done" when the run ends.
      const existing = room.submissions.get(player.id);
      const best = Math.max(payload.score || 0, existing?.score || 0);
      room.submissions.set(player.id, { score: best });
      if (payload.done) {
        room.done.add(player.id);
        const activeCount = [...room.players.values()].filter((p) => p.connected).length;
        io.to(room.hostRoom).emit("round:answered", { count: room.done.size, total: activeCount, label: "finished" });
        maybeFinishEarly(room);
      }
      return;
    }
    room.submissions.set(player.id, sub);

    socket.emit("submit:ack", { mode: game.mode });
    const activeCount = [...room.players.values()].filter((p) => p.connected).length;
    io.to(room.hostRoom).emit("round:answered", { count: room.submissions.size, total: activeCount });
    maybeFinishEarly(room);
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.role === "host" && room.hostSocketId === socket.id) {
      // Don't nuke the room on a transient blip (refresh, tab switch, flaky
      // network). Give the host a grace window to reconnect via host:reattach.
      room.hostConnected = false;
      io.to(room.playerRoom).emit("host:paused", { message: "Host connection lost. Reconnecting…" });
      if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = setTimeout(() => {
        if (!room.hostConnected) {
          clearTimers(room);
          io.to(room.code).emit("room:closed", { message: "Host left the game." });
          rooms.delete(code);
        }
      }, 60000);
      return;
    }

    if (socket.data.role === "player") {
      const player = room.players.get(socket.data.playerId);
      if (player) {
        player.connected = false;
        io.to(room.code).emit("room:players", { players: publicPlayers(room) });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  PartyPlay is live!`);
  console.log(`  Host screen : http://localhost:${PORT}`);
  console.log(`  On your LAN : http://${LAN_IP}:${PORT}`);
  console.log(`  Players join : http://${LAN_IP}:${PORT}/play\n`);
});
