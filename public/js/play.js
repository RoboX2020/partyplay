const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});

const $ = (id) => document.getElementById(id);
const sections = ["join", "queue", "playing", "spectate", "turnOver"];
function show(id) {
  sections.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

let me = null;
let frameTimer = null;
let arcadeRef = null;
let liveScore = 0;
const stored = JSON.parse(sessionStorage.getItem("pp_player") || "null");

let wasDisconnected = false;
function setNet(state, msg) {
  const b = $("netBanner");
  b.classList.toggle("show", state !== "hide");
  b.classList.toggle("bad", state === "bad");
  b.classList.toggle("good", state === "good");
  if (msg) $("netMsg").textContent = msg;
}
setNet("wait", "Connecting…");

const params = new URLSearchParams(location.search);
const prefill = (params.get("room") || stored?.code || "").toUpperCase();
if (prefill) $("codeInput").value = prefill;
if (stored?.name) $("nameInput").value = stored.name;

$("codeInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = $("codeInput").value.trim().toUpperCase();
  const name = $("nameInput").value.trim();
  if (code.length < 4) return ($("joinErr").textContent = "Enter the 4-letter room code.");
  if (!name) return ($("joinErr").textContent = "Pick a nickname.");
  $("joinErr").textContent = "";
  $("joinBtn").disabled = true;
  socket.emit("player:join", { code, name, playerId: me?.playerId });
});

socket.on("connect", () => {
  if (wasDisconnected && me) {
    setNet("good", "Reconnected");
    setTimeout(() => setNet("hide"), 1600);
  } else setNet("hide");
  wasDisconnected = false;
  const s = me ? { code: me.code, name: me.name, playerId: me.playerId } : stored;
  if (s?.code && s?.playerId) socket.emit("player:join", s);
});
socket.on("disconnect", () => { wasDisconnected = true; setNet("bad", "Connection lost — reconnecting…"); });
socket.io.on("reconnect_attempt", (n) => { wasDisconnected = true; setNet("bad", `Reconnecting… (attempt ${n})`); });
socket.on("host:paused", ({ message }) => setNet("bad", message || "Host reconnecting…"));
socket.on("host:resumed", () => { setNet("good", "Host back"); setTimeout(() => setNet("hide"), 1500); });

socket.on("player:joinError", ({ message }) => {
  $("joinBtn").disabled = false;
  $("joinErr").textContent = message;
  if (!me) { sessionStorage.removeItem("pp_player"); show("join"); }
});

function setMe(data) {
  me = { ...data, playerId: data.playerId || data.id };
  sessionStorage.setItem("pp_player", JSON.stringify({ code: me.code, name: me.name, playerId: me.playerId }));
  ["meAv", "waitAv", "playAv", "specAv", "overAv"].forEach((id) => { if ($(id)) $(id).textContent = me.avatar; });
  ["meName", "playName", "specName"].forEach((id) => { if ($(id)) $(id).textContent = me.name; });
  if ($("meCode")) $("meCode").textContent = me.code;
}

socket.on("player:joined", (data) => {
  setMe(data);
  $("joinBtn").disabled = false;
  if (data.isActive) return;
  $("queuePos").textContent = data.queuePosition || "?";
  $("queueTitle").textContent = data.isFirst && data.sessionOpen ? "You're up next!" : "You're in the queue";
  $("queueMsg").innerHTML = data.sessionOpen
    ? `<span class="dots">${data.isFirst ? "Get ready — your turn is coming" : "Watch the big screen while you wait"}</span>`
    : `<span class="dots">Waiting for the host to open the floor</span>`;
  show("queue");
});

socket.on("queue:update", ({ queue, active, sessionOpen }) => {
  if (!me) return;
  const pos = queue.findIndex((p) => p.id === me.playerId) + 1;
  if ($("queuePos")) $("queuePos").textContent = pos || "—";
  if ($("specPos")) $("specPos").textContent = pos || "—";
  if (active && $("nowPlaying")) {
    $("nowPlaying").style.display = "block";
    $("nowPlaying").textContent = `${active.avatar} ${active.name} is on the big screen now`;
  }
  if (!sessionOpen && !document.getElementById("playing").classList.contains("hidden")) return;
  if (me.playerId !== active?.id && document.getElementById("playing").classList.contains("hidden")) {
    if (pos === 1 && sessionOpen) {
      $("queueTitle").textContent = "You're up next!";
      show("queue");
    }
  }
});

socket.on("session:open", () => {
  if (!me) return;
  $("queueMsg").innerHTML = `<span class="dots">Floor is open — watch the big screen</span>`;
  show("queue");
});

socket.on("session:closed", () => {
  stopPlaying();
  if (me) show("queue");
});

function stopPlaying() {
  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
  if (arcadeRef) { try { arcadeRef.stop(); } catch {} arcadeRef = null; }
}

socket.on("turn:start", ({ gameId, game, duration }) => {
  stopPlaying();
  liveScore = 0;
  show("playing");
  $("playScore").textContent = "0";
  const stage = $("pStage");
  stage.innerHTML = `<canvas id="arcadeCanvas" style="flex:1;width:100%;min-height:55vh;border-radius:12px;display:block;background:#0b0f17;touch-action:none;"></canvas>`;
  requestAnimationFrame(() => {
    const canvas = $("arcadeCanvas");
    let lastEmit = 0;
    arcadeRef = window.Arcade.start(gameId, canvas, {
      duration,
      onScore: (s) => {
        liveScore = s;
        $("playScore").textContent = s;
        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          socket.emit("player:submit", { score: s });
        }
      },
      onEnd: (s) => {
        liveScore = s;
        socket.emit("player:submit", { score: s, done: true });
        stopPlaying();
        stage.innerHTML = `<div class="feedback"><div class="icon">${game.emoji}</div><div class="pts">${s}</div><p class="tag">Run complete — everyone saw it live!</p></div>`;
      },
    });
    frameTimer = setInterval(() => {
      if (!canvas.width) return;
      try {
        const frame = canvas.toDataURL("image/jpeg", 0.5);
        socket.emit("player:frame", { frame, score: liveScore });
      } catch {}
    }, 120);
  });
});

socket.on("turn:spectate", ({ player, game, queuePosition }) => {
  stopPlaying();
  if ($("specPlayAv")) $("specPlayAv").textContent = player?.avatar || "🎮";
  $("specTitle").textContent = `${player?.name || "Someone"} is playing`;
  $("specMsg").textContent = `${game?.emoji || ""} ${game?.name || "Game"} — watch the TV! You're #${queuePosition || "?"} in line.`;
  if ($("specPos")) $("specPos").textContent = queuePosition || "—";
  show("spectate");
});

socket.on("turn:over", (data) => {
  stopPlaying();
  if (data.you) {
    $("overTitle").textContent = "Your run is over!";
    $("overScore").textContent = `${data.score} pts`;
    $("overMsg").textContent = "Everyone saw it on the big screen!";
  } else {
    $("overAv").textContent = data.player?.avatar || "🎮";
    $("overTitle").textContent = `${data.player?.name || "Player"} scored ${data.score}`;
    $("overScore").textContent = "";
    $("overMsg").textContent = "Your turn is coming up…";
  }
  show("turnOver");
  setTimeout(() => show("queue"), 3200);
});

socket.on("room:closed", ({ message }) => {
  stopPlaying();
  sessionStorage.removeItem("pp_player");
  me = null;
  alert(message || "Host left.");
  show("join");
  $("joinBtn").disabled = false;
});
