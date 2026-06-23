import express from "express";
import http from "http";
import { Server } from "socket.io";
import QRCode from "qrcode";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getGame, arcadeCatalog } from "./src/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

app.use(express.static(path.join(__dirname, "public")));
app.get("/host", (_req, res) => res.sendFile(path.join(__dirname, "public", "host.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(__dirname, "public", "play.html")));

function getLanIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) return iface.address;
      }
    }
  } catch {}
  return process.env.HOST_IP || "localhost";
}
const LAN_IP = getLanIp();

const AVATARS = ["🦊", "🐼", "🐸", "🦁", "🐧", "🐙", "🦄", "🐝", "🐲", "🦉", "🐬", "🦖", "🐳", "🦋", "🐢", "🦜"];
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function resolveBaseUrl(origin) {
  const sanitize = (u) => (u || "").replace(/\/+$/, "");
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

function publicPlayer(p) {
  return { id: p.id, name: p.name, avatar: p.avatar, bestScore: p.bestScore, connected: p.connected };
}

function publicQueue(room) {
  return room.queue
    .map((id) => room.players.get(id))
    .filter(Boolean)
    .map(publicPlayer);
}

function hallOfFame(room) {
  return [...room.players.values()]
    .filter((p) => p.bestScore > 0)
    .sort((a, b) => b.bestScore - a.bestScore)
    .map(publicPlayer);
}

function broadcastQueue(room) {
  const payload = {
    queue: publicQueue(room),
    active: room.activePlayerId ? publicPlayer(room.players.get(room.activePlayerId)) : null,
    sessionOpen: room.sessionOpen,
    gameId: room.gameId,
  };
  io.to(room.code).emit("queue:update", payload);
}

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

function activePlayer(room) {
  return room.activePlayerId ? room.players.get(room.activePlayerId) : null;
}

function removeFromQueue(room, playerId) {
  room.queue = room.queue.filter((id) => id !== playerId);
}

function enqueuePlayer(room, playerId) {
  if (!room.queue.includes(playerId)) room.queue.push(playerId);
}

function maybeStartTurn(room) {
  if (!room.sessionOpen || !room.gameId || room.activePlayerId) return;
  const nextId = room.queue.find((id) => {
    const p = room.players.get(id);
    return p && p.connected;
  });
  if (!nextId) return;
  beginTurn(room, nextId);
}

function beginTurn(room, playerId) {
  const game = getGame(room.gameId);
  const player = room.players.get(playerId);
  if (!game || !player || !player.connected) return;

  clearTimers(room);
  room.activePlayerId = playerId;
  room.turnScore = 0;
  room.turnStart = Date.now();
  room.state = "live";

  removeFromQueue(room, playerId);

  const turnPayload = {
    gameId: game.id,
    game: { id: game.id, name: game.name, emoji: game.emoji, color: game.color },
    duration: game.roundDuration,
    player: publicPlayer(player),
  };

  io.to(room.hostRoom).emit("live:start", turnPayload);
  io.to(room.code).emit("turn:announce", {
    player: publicPlayer(player),
    game: turnPayload.game,
  });

  const sock = io.sockets.sockets.get(player.socketId);
  if (sock) sock.emit("turn:start", turnPayload);

  // Everyone else sees queue / spectate status on their phones.
  for (const p of room.players.values()) {
    if (p.id === playerId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("turn:spectate", { player: publicPlayer(player), game: turnPayload.game });
  }

  broadcastQueue(room);

  room.timers.push(
    setTimeout(() => endTurn(room, room.turnScore, "time"), game.roundDuration + 2000)
  );
}

function endTurn(room, score, reason = "done") {
  if (room.state !== "live" || !room.activePlayerId) return;
  clearTimers(room);

  const player = room.players.get(room.activePlayerId);
  const finalScore = Math.max(0, score || room.turnScore || 0);
  if (player) {
    player.bestScore = Math.max(player.bestScore || 0, finalScore);
  }

  const game = getGame(room.gameId);
  room.state = "turn_result";
  room.activePlayerId = null;

  io.to(room.hostRoom).emit("live:end", {
    player: player ? publicPlayer(player) : null,
    score: finalScore,
    reason,
    game: game ? { id: game.id, name: game.name, emoji: game.emoji } : null,
    hall: hallOfFame(room),
  });

  if (player) {
    const sock = io.sockets.sockets.get(player.socketId);
    if (sock) sock.emit("turn:over", { score: finalScore, hall: hallOfFame(room), you: true });
  }

  for (const p of room.players.values()) {
    if (p.id === player?.id) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("turn:over", { score: finalScore, player: player ? publicPlayer(player) : null, hall: hallOfFame(room), you: false });
  }

  broadcastQueue(room);

  room.timers.push(setTimeout(() => {
    room.state = room.sessionOpen ? "open" : "lobby";
    maybeStartTurn(room);
    if (!room.activePlayerId) {
      io.to(room.hostRoom).emit("live:idle", { hall: hallOfFame(room), queue: publicQueue(room) });
    }
  }, 3500));
}

function roomSnapshot(room) {
  const game = room.gameId ? getGame(room.gameId) : null;
  return {
    code: room.code,
    state: room.state,
    sessionOpen: room.sessionOpen,
    gameId: room.gameId,
    game: game ? { id: game.id, name: game.name, emoji: game.emoji, color: game.color } : null,
    queue: publicQueue(room),
    active: room.activePlayerId ? publicPlayer(room.players.get(room.activePlayerId)) : null,
    hall: hallOfFame(room),
  };
}

io.on("connection", (socket) => {
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
      queue: [],
      state: "lobby",
      sessionOpen: false,
      gameId: null,
      activePlayerId: null,
      turnScore: 0,
      turnStart: 0,
      timers: [],
    };
    rooms.set(code, room);
    socket.join(code);
    socket.join(room.hostRoom);
    socket.data.role = "host";
    socket.data.roomCode = code;

    const { joinUrl, qr } = await buildJoinPayload(room);
    socket.emit("host:created", {
      ...roomSnapshot(room),
      joinUrl,
      qr,
      games: arcadeCatalog(),
    });
  });

  socket.on("host:reattach", async ({ code, origin } = {}) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("host:reattachFailed");
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
    socket.emit("host:reattached", { ...roomSnapshot(room), joinUrl, qr, games: arcadeCatalog() });
  });

  socket.on("host:selectGame", ({ gameId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id || room.sessionOpen) return;
    if (!getGame(gameId)) return;
    room.gameId = gameId;
    io.to(room.code).emit("game:selected", { gameId, game: getGame(gameId) });
    broadcastQueue(room);
  });

  socket.on("host:openFloor", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!room.gameId) return socket.emit("host:error", { message: "Pick a game first." });
    room.sessionOpen = true;
    room.state = "open";
    io.to(room.code).emit("session:open", { gameId: room.gameId, game: getGame(room.gameId) });
    broadcastQueue(room);
    maybeStartTurn(room);
  });

  socket.on("host:closeFloor", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    room.sessionOpen = false;
    if (room.state === "live") endTurn(room, room.turnScore, "closed");
    room.state = "lobby";
    io.to(room.code).emit("session:closed");
    broadcastQueue(room);
  });

  socket.on("host:skipTurn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostSocketId !== socket.id || !room.activePlayerId) return;
    endTurn(room, room.turnScore, "skipped");
  });

  socket.on("player:join", (payload = {}) => {
    const { name, playerId } = payload;
    const code = (payload.room || payload.code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("player:joinError", { message: "Room not found. Check the code." });

    let player = playerId ? room.players.get(playerId) : null;
    const wasInQueue = player && room.queue.includes(player.id);

    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    } else {
      const cleanName = (name || "").trim().slice(0, 14) || "Player";
      const id = `p_${Math.random().toString(36).slice(2, 9)}`;
      const usedAvatars = new Set([...room.players.values()].map((p) => p.avatar));
      const avatar = AVATARS.find((a) => !usedAvatars.has(a)) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
      player = { id, name: cleanName, avatar, bestScore: 0, connected: true, socketId: socket.id };
      room.players.set(id, player);
    }

    socket.join(code);
    socket.join(room.playerRoom);
    socket.data.role = "player";
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    // New joiners go to the back of the line (unless reconnecting same id already queued).
    if (!wasInQueue && player.id !== room.activePlayerId) enqueuePlayer(room, player.id);

    socket.emit("player:joined", {
      ...publicPlayer(player),
      playerId: player.id,
      code,
      queuePosition: room.queue.indexOf(player.id) + 1,
      queueLength: room.queue.length,
      sessionOpen: room.sessionOpen,
      gameId: room.gameId,
      isActive: player.id === room.activePlayerId,
      isFirst: room.queue[0] === player.id,
    });

    broadcastQueue(room);

    // Resume mid-turn for the active player after reconnect.
    if (player.id === room.activePlayerId && room.state === "live" && room.gameId) {
      const game = getGame(room.gameId);
      const remaining = Math.max(2000, game.roundDuration - (Date.now() - room.turnStart));
      socket.emit("turn:start", {
        gameId: game.id,
        game: { id: game.id, name: game.name, emoji: game.emoji, color: game.color },
        duration: remaining,
        player: publicPlayer(player),
        resume: true,
      });
    } else if (player.id !== room.activePlayerId && room.activePlayerId && room.state === "live") {
      const ap = room.players.get(room.activePlayerId);
      socket.emit("turn:spectate", {
        player: ap ? publicPlayer(ap) : null,
        game: getGame(room.gameId),
        queuePosition: room.queue.indexOf(player.id) + 1,
      });
    } else {
      maybeStartTurn(room);
    }
  });

  socket.on("player:frame", ({ frame, score } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== "live") return;
    if (socket.data.playerId !== room.activePlayerId) return;
    if (typeof score === "number") room.turnScore = Math.max(room.turnScore, score);
    if (frame) {
      io.to(room.hostRoom).emit("live:frame", {
        frame,
        score: room.turnScore,
        player: publicPlayer(room.players.get(room.activePlayerId)),
      });
    }
  });

  socket.on("player:submit", (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== "live") return;
    if (socket.data.playerId !== room.activePlayerId) return;
    if (typeof payload.score === "number") room.turnScore = Math.max(room.turnScore, payload.score);
    if (payload.done) endTurn(room, room.turnScore, "done");
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.role === "host" && room.hostSocketId === socket.id) {
      room.hostConnected = false;
      io.to(room.playerRoom).emit("host:paused", { message: "Host reconnecting…" });
      if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = setTimeout(() => {
        if (!room.hostConnected) {
          clearTimers(room);
          io.to(room.code).emit("room:closed", { message: "Host left." });
          rooms.delete(code);
        }
      }, 60000);
      return;
    }

    if (socket.data.role === "player") {
      const player = room.players.get(socket.data.playerId);
      if (!player) return;
      player.connected = false;

      if (player.id === room.activePlayerId && room.state === "live") {
        endTurn(room, room.turnScore, "disconnect");
      } else {
        removeFromQueue(room, player.id);
        broadcastQueue(room);
        maybeStartTurn(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  PartyPlay Live Showcase`);
  console.log(`  Host screen : http://localhost:${PORT}/host`);
  console.log(`  On your LAN : http://${LAN_IP}:${PORT}`);
  console.log(`  Players join : http://${LAN_IP}:${PORT}/play\n`);
});
