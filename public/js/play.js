const socket = io();
const $ = (id) => document.getElementById(id);
const sections = ["join", "wait", "game", "pGameover"];
function show(id) {
  sections.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

let me = null; // { playerId, name, avatar, code }
let lastJoin = null;
let roundState = null;

// Prefill room code from the QR link (?room=ABCD).
const params = new URLSearchParams(location.search);
if (params.get("room")) $("codeInput").value = params.get("room").toUpperCase();

$("codeInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = $("codeInput").value.trim().toUpperCase();
  const name = $("nameInput").value.trim();
  if (code.length < 4) return ($("joinErr").textContent = "Enter the 4-letter room code.");
  if (!name) return ($("joinErr").textContent = "Pick a nickname!");
  $("joinErr").textContent = "";
  $("joinBtn").disabled = true;
  lastJoin = { code, name, playerId: null };
  socket.emit("player:join", lastJoin);
});

// Reconnect support within the session.
socket.on("connect", () => {
  if (lastJoin && me) socket.emit("player:join", { ...lastJoin, playerId: me.playerId });
});

socket.on("player:joinError", ({ message }) => {
  $("joinBtn").disabled = false;
  $("joinErr").textContent = message;
});

socket.on("player:joined", (data) => {
  me = data;
  lastJoin.playerId = data.playerId;
  $("meAv").textContent = data.avatar;
  $("gAv").textContent = data.avatar;
  $("meName").textContent = data.name;
  $("gName").textContent = data.name;
  $("waitAv").textContent = data.avatar;
  $("meCode").textContent = data.code;
  if (data.state === "lobby" || data.state === "gameover") show("wait");
  else show("wait"); // mid-game joiners wait for the next round
});

socket.on("room:closed", ({ message }) => {
  alert(message || "The host left. Game over.");
  show("join");
  $("joinBtn").disabled = false;
  me = null;
});

socket.on("lobby:return", () => {
  if (me) show("wait");
});

socket.on("game:intro", ({ game }) => {
  show("game");
  $("pStage").innerHTML = `<div class="feedback"><div class="icon">${game.emoji}</div>
    <h2>${game.name}</h2><p class="tag">${game.description}</p>
    <div class="rank-pill">Get ready…</div></div>`;
});

/* ---------------- Round start ---------------- */
socket.on("round:start", (data) => {
  show("game");
  roundState = { mode: data.mode, gameId: data.gameId, submitted: false, taps: 0, tapTimer: null };
  const stage = $("pStage");

  if (data.mode === "quiz") renderQuiz(stage, data);
  else if (data.mode === "reaction") renderReactionWait(stage);
  else if (data.mode === "tap") renderTap(stage, data.duration);
});

socket.on("round:go", () => {
  if (!roundState || roundState.mode !== "reaction" || roundState.submitted) return;
  const zone = $("reactZone");
  if (!zone) return;
  zone.classList.remove("wait");
  zone.classList.add("go");
  zone.innerHTML = `<div>TAP NOW!</div><div style="font-size:1rem;">⚡</div>`;
  roundState.goLocal = performance.now();
});

/* ---------------- Quiz rendering ---------------- */
function renderQuiz(stage, data) {
  const v = data.view;
  if (data.gameId === "color") {
    stage.innerHTML = `
      <div class="p-prompt">Tap the <b>COLOR</b> of this word</div>
      <div class="stroop-word" style="font-size:3.4rem; color:${v.inkHex}; margin:6px 0 14px;">${v.word}</div>
      <div class="p-options" id="pOpts"></div>`;
    $("pOpts").innerHTML = v.options
      .map((o, i) => `<button class="opt-btn" data-i="${i}" style="background:${o.hex}">${o.name}</button>`)
      .join("");
  } else {
    stage.innerHTML = `
      <div class="p-prompt">${escapeHtml(v.prompt)}</div>
      <div class="p-options" id="pOpts"></div>`;
    $("pOpts").innerHTML = v.options
      .map((o, i) => `<button class="opt-btn c${i}" data-i="${i}">${escapeHtml(o)}</button>`)
      .join("");
  }
  $("pOpts")
    .querySelectorAll(".opt-btn")
    .forEach((b) =>
      b.addEventListener("click", () => {
        if (roundState.submitted) return;
        roundState.submitted = true;
        const idx = +b.dataset.i;
        document.querySelectorAll(".opt-btn").forEach((x) => {
          x.classList.add(x === b ? "chosen" : "dimmed");
        });
        socket.emit("player:submit", { answer: idx });
        setTimeout(() => waitingForOthers(), 350);
      })
    );
}

/* ---------------- Reaction rendering ---------------- */
function renderReactionWait(stage) {
  stage.innerHTML = `<div class="react-zone wait" id="reactZone">
    <div>Wait for it…</div><div style="font-size:1rem;">Don't tap until GREEN!</div></div>`;
  $("reactZone").addEventListener("click", () => {
    if (!roundState || roundState.submitted) return;
    const zone = $("reactZone");
    if (zone.classList.contains("go")) {
      roundState.submitted = true;
      socket.emit("player:submit", {});
      zone.innerHTML = `<div>⚡ Tapped!</div>`;
    } else {
      // tapped too early
      roundState.submitted = true;
      socket.emit("player:submit", {});
      zone.classList.remove("wait");
      zone.classList.add("early");
      zone.innerHTML = `<div>🐢 Too early!</div><div style="font-size:1rem;">Wait for green next time</div>`;
    }
  });
}

/* ---------------- Tap rendering ---------------- */
function renderTap(stage, duration) {
  stage.innerHTML = `<div class="tap-zone" id="tapZone">
    <div class="count" id="tapCount">0</div><div>TAP! TAP! TAP!</div></div>`;
  const zone = $("tapZone");
  const onTap = () => {
    if (roundState.ended) return;
    roundState.taps++;
    $("tapCount").textContent = roundState.taps;
  };
  zone.addEventListener("pointerdown", onTap);
  // Stream the running count to the server a few times a second.
  roundState.tapTimer = setInterval(() => {
    socket.emit("player:submit", { taps: roundState.taps });
  }, 250);
  setTimeout(() => {
    roundState.ended = true;
    clearInterval(roundState.tapTimer);
    socket.emit("player:submit", { taps: roundState.taps });
    waitingForOthers();
  }, duration + 150);
}

function waitingForOthers() {
  const stage = $("pStage");
  if (roundState && roundState.mode === "tap") {
    stage.innerHTML = `<div class="feedback"><div class="icon">👆</div>
      <div class="pts">${roundState.taps} taps!</div>
      <p class="tag"><span class="dots">Waiting for results</span></p></div>`;
  } else {
    stage.innerHTML = `<div class="feedback"><div class="icon">⏳</div>
      <h2>Answer locked in!</h2>
      <p class="tag"><span class="dots">Waiting for others</span></p></div>`;
  }
}

/* ---------------- Results ---------------- */
let pendingResult = null;
socket.on("round:result", (r) => {
  pendingResult = r;
  $("gScore").textContent = r.totalScore;
});

socket.on("round:rank", ({ rank, total }) => {
  const r = pendingResult || {};
  const good = r.correct;
  const stage = $("pStage");
  let icon = good ? "✅" : "❌";
  let headline = good ? "Nice!" : "Missed it!";
  if (roundState && roundState.mode === "reaction") {
    if (r.reactionMs == null) { icon = "🐢"; headline = "Too early!"; }
    else { icon = "⚡"; headline = `${r.reactionMs} ms`; }
  } else if (roundState && roundState.mode === "tap") {
    icon = "👆"; headline = `${r.taps} taps`;
  }
  const rankTxt = rank === 1 ? "🥇 1st place!" : rank === 2 ? "🥈 2nd place" : rank === 3 ? "🥉 3rd place" : `#${rank} of ${total}`;
  stage.innerHTML = `<div class="feedback ${good ? "good" : "bad"} fade-in">
    <div class="icon">${icon}</div>
    <h2>${headline}</h2>
    <div class="pts">+${r.points || 0}</div>
    <div class="rank-pill">${rankTxt}</div>
    <p class="tag">Total: ${r.totalScore} pts</p></div>`;
});

/* ---------------- Game over ---------------- */
socket.on("game:over", ({ winner, leaderboard }) => {
  show("pGameover");
  const myRank = leaderboard.findIndex((p) => p.id === me?.playerId) + 1;
  const myEntry = leaderboard.find((p) => p.id === me?.playerId);
  const iWon = winner && me && winner.id === me.playerId;
  $("overAv").textContent = me?.avatar || "🎉";
  if (iWon) {
    $("overTitle").textContent = "👑 You WON!";
    $("overRank").textContent = "Champion!";
    if (window.confettiBurst) { window.confettiBurst(220); setTimeout(() => window.confettiBurst(160), 900); }
  } else {
    $("overTitle").textContent = "Game Over!";
    $("overRank").textContent = myRank === 2 ? "🥈 2nd place" : myRank === 3 ? "🥉 3rd place" : `#${myRank} of ${leaderboard.length}`;
  }
  $("overScore").textContent = `${myEntry ? myEntry.score : 0} points · Winner: ${winner ? winner.name : "—"}`;
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
