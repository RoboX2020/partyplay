const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});

const $ = (id) => document.getElementById(id);
const sections = ["lobby", "live", "turnResult"];
function show(id) {
  sections.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

let games = [];
let selectedGame = null;
let sessionOpen = false;
let timerInt = null;
let floorOpen = false;

let wasDisconnected = false;
function setNet(state, msg) {
  const b = $("netBanner");
  b.classList.toggle("show", state !== "hide");
  b.classList.toggle("bad", state === "bad");
  b.classList.toggle("good", state === "good");
  if (msg) $("netMsg").textContent = msg;
}
setNet("wait", "Connecting to server…");

socket.on("connect", () => {
  if (wasDisconnected) {
    setNet("good", "Reconnected");
    setTimeout(() => setNet("hide"), 1600);
    wasDisconnected = false;
  } else setNet("hide");
  const code = sessionStorage.getItem("pp_host_code");
  if (code) socket.emit("host:reattach", { code, origin: window.location.origin });
  else socket.emit("host:create", { origin: window.location.origin });
});
socket.on("disconnect", () => { wasDisconnected = true; setNet("bad", "Connection lost — reconnecting…"); });
socket.io.on("reconnect_attempt", (n) => { wasDisconnected = true; setNet("bad", `Reconnecting… (attempt ${n})`); });

function applyRoom(data) {
  $("roomCode").textContent = data.code;
  $("qr").src = data.qr || "";
  $("joinUrl").textContent = (data.joinUrl || "").replace(/^https?:\/\//, "");
  sessionStorage.setItem("pp_host_code", data.code);
  games = data.games || [];
  sessionOpen = !!data.sessionOpen;
  floorOpen = sessionOpen;
  selectedGame = data.gameId || selectedGame;
  renderGamePicker();
  renderQueue(data.queue || [], data.active);
  renderHall($("hallLobby"), data.hall || []);
  updateSessionPill();
  updateOpenBtn();
}

socket.on("host:created", (data) => { applyRoom(data); show("lobby"); });
socket.on("host:reattached", (data) => {
  applyRoom(data);
  if (data.state === "live") show("live");
  else if (data.state === "turn_result") show("turnResult");
  else show(floorOpen ? "live" : "lobby");
});
socket.on("host:reattachFailed", () => {
  sessionStorage.removeItem("pp_host_code");
  socket.emit("host:create", { origin: window.location.origin });
});
socket.on("host:error", ({ message }) => alert(message));
socket.on("room:closed", ({ message }) => {
  sessionStorage.removeItem("pp_host_code");
  alert(message || "Room closed.");
  socket.emit("host:create", { origin: window.location.origin });
});

socket.on("queue:update", ({ queue, active, sessionOpen: open }) => {
  sessionOpen = open;
  floorOpen = open;
  renderQueue(queue, active);
  updateSessionPill();
  updateOpenBtn();
});

socket.on("session:open", () => {
  floorOpen = true;
  sessionOpen = true;
  updateSessionPill();
  updateOpenBtn();
  show("live");
  setProjectionIdle(true);
});

function renderGamePicker() {
  $("gamePicker").innerHTML = games
    .map(
      (g) => `<div class="game-tile ${selectedGame === g.id ? "sel" : ""} ${floorOpen ? "locked" : ""}" data-id="${g.id}" style="--c:${g.color}">
        <div class="ge">${g.emoji}</div>
        <h4>${g.name}</h4>
        <p>${g.description}</p></div>`
    )
    .join("");
  document.querySelectorAll(".game-tile:not(.locked)").forEach((t) => {
    t.addEventListener("click", () => {
      if (floorOpen) return;
      selectedGame = t.dataset.id;
      document.querySelectorAll(".game-tile").forEach((x) => x.classList.toggle("sel", x.dataset.id === selectedGame));
      socket.emit("host:selectGame", { gameId: selectedGame });
      updateOpenBtn();
    });
  });
}

function renderQueue(queue, active) {
  $("queueCount").textContent = queue.length + (active ? 1 : 0);
  const el = $("queueList");
  const parts = [];
  if (active) {
    parts.push(`<div class="queue-row active"><span class="av">${active.avatar}</span><span>${escapeHtml(active.name)}</span><span class="queue-tag">PLAYING NOW</span></div>`);
  }
  queue.forEach((p, i) => {
    parts.push(`<div class="queue-row"><span class="pos">${i + 1}</span><span class="av">${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`);
  });
  el.innerHTML = parts.length ? parts.join("") : `<div class="empty-hint">Waiting for someone to scan…</div>`;
  $("queueMini").innerHTML = parts.length ? parts.join("") : `<span class="tag">Queue empty — scan to play</span>`;
}

function renderHall(el, hall) {
  if (!hall.length) {
    el.innerHTML = `<div class="empty-hint">No scores yet</div>`;
    return;
  }
  el.innerHTML = hall
    .map((p, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || i + 1;
      return `<div class="lb-row ${i < 3 ? "top" + (i + 1) : ""}"><span class="rank">${medal}</span><span class="av">${p.avatar}</span><span class="nm">${escapeHtml(p.name)}</span><span class="sc">${p.bestScore}</span></div>`;
    })
    .join("");
}

function updateSessionPill() {
  $("sessionPill").textContent = floorOpen ? "Floor open" : "Lobby";
  $("sessionPill").classList.toggle("open", floorOpen);
}

function updateOpenBtn() {
  const btn = $("openBtn");
  if (floorOpen) {
    btn.textContent = "Floor is open";
    btn.disabled = true;
  } else {
    btn.textContent = "Open the floor";
    btn.disabled = !selectedGame;
  }
}

$("openBtn").addEventListener("click", () => {
  if (!selectedGame || floorOpen) return;
  socket.emit("host:openFloor");
  show("live");
  setProjectionIdle(true);
});

$("closeBtn").addEventListener("click", () => socket.emit("host:closeFloor"));
$("skipBtn").addEventListener("click", () => socket.emit("host:skipTurn"));

socket.on("session:closed", () => {
  floorOpen = false;
  sessionOpen = false;
  stopTimer();
  updateSessionPill();
  updateOpenBtn();
  renderGamePicker();
  show("lobby");
});

function setProjectionIdle(on) {
  $("projectionIdle").classList.toggle("hidden", !on);
  if (on) $("projection").removeAttribute("src");
}

socket.on("live:start", ({ player, game, duration }) => {
  show("live");
  setProjectionIdle(false);
  $("liveAv").textContent = player.avatar;
  $("liveName").textContent = player.name;
  $("liveGame").textContent = `${game.emoji} ${game.name}`;
  $("liveScore").textContent = "0";
  startTimer(duration);
});

socket.on("live:frame", ({ frame, score, player }) => {
  if (frame) {
    $("projection").src = frame;
    setProjectionIdle(false);
  }
  if (typeof score === "number") $("liveScore").textContent = score;
  if (player) {
    $("liveAv").textContent = player.avatar;
    $("liveName").textContent = player.name;
  }
});

socket.on("live:end", ({ player, score, game, hall }) => {
  stopTimer();
  show("turnResult");
  $("turnEmoji").textContent = game?.emoji || "🎮";
  $("turnTitle").textContent = player ? `${player.name}'s run` : "Turn over";
  $("turnScoreLine").textContent = `${score} points`;
  $("turnNext").textContent = "Next player up in a moment…";
  renderHall($("hallTurn"), hall || []);
  if (score >= 20 && window.confettiBurst) window.confettiBurst(120);
});

socket.on("live:idle", ({ hall, queue }) => {
  show("live");
  setProjectionIdle(true);
  renderHall($("hallLobby"), hall || []);
  renderQueue(queue || [], null);
});

socket.on("turn:announce", ({ player, game }) => {
  if (floorOpen) {
    show("live");
    $("liveAv").textContent = player.avatar;
    $("liveName").textContent = player.name;
    $("liveGame").textContent = `${game.emoji} ${game.name}`;
  }
});

function startTimer(duration) {
  stopTimer();
  const end = Date.now() + duration;
  const update = () => {
    const left = Math.max(0, end - Date.now());
    $("liveTimer").textContent = Math.ceil(left / 1000);
    $("liveTimerFill").style.width = Math.max(0, (left / duration) * 100) + "%";
    if (left <= 0) stopTimer();
  };
  update();
  timerInt = setInterval(update, 100);
}

function stopTimer() {
  if (timerInt) clearInterval(timerInt);
  timerInt = null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
