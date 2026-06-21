const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});
const $ = (id) => document.getElementById(id);
const sections = ["join", "wait", "game", "pGameover"];
function show(id) {
  sections.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

let me = null; // { playerId, name, avatar, code }
let roundState = null;
const stored = JSON.parse(sessionStorage.getItem("pp_player") || "null");

/* ---------------- Connection status ---------------- */
let wasDisconnected = false;
function setNet(state, msg) {
  // state: "hide" | "wait" | "bad" | "good"
  const b = $("netBanner");
  b.classList.toggle("show", state !== "hide");
  b.classList.toggle("bad", state === "bad");
  b.classList.toggle("good", state === "good");
  if (msg) $("netMsg").textContent = msg;
}
setNet("wait", "Connecting…");

// Prefill room code from the QR link (?room=ABCD), or a stored session.
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

// (Re)connect support: rejoin automatically after a drop or page refresh.
socket.on("connect", () => {
  if (wasDisconnected && me) {
    setNet("good", "Reconnected");
    setTimeout(() => setNet("hide"), 1600);
  } else {
    setNet("hide");
  }
  wasDisconnected = false;
  const s = me ? { code: me.code, name: me.name, playerId: me.playerId } : stored;
  if (s && s.code && s.playerId) socket.emit("player:join", s);
});
socket.on("disconnect", () => { wasDisconnected = true; setNet("bad", "Connection lost — reconnecting…"); });
socket.io.on("reconnect_attempt", (n) => { wasDisconnected = true; setNet("bad", `Reconnecting… (attempt ${n})`); });
socket.on("host:paused", ({ message }) => setNet("bad", message || "Host reconnecting…"));
socket.on("host:resumed", () => { setNet("good", "Host reconnected"); setTimeout(() => setNet("hide"), 1500); });

socket.on("player:joinError", ({ message }) => {
  $("joinBtn").disabled = false;
  $("joinErr").textContent = message;
  // A stale stored session pointing at a dead room should not trap the user.
  if (!me) { sessionStorage.removeItem("pp_player"); show("join"); }
});

socket.on("player:joined", (data) => {
  me = data;
  sessionStorage.setItem("pp_player", JSON.stringify({ code: data.code, name: data.name, playerId: data.playerId }));
  $("meAv").textContent = data.avatar;
  $("gAv").textContent = data.avatar;
  $("meName").textContent = data.name;
  $("gName").textContent = data.name;
  $("waitAv").textContent = data.avatar;
  $("meCode").textContent = data.code;
  // Lobby / between games → waiting screen. Mid-game joiners also wait for the
  // next round; if a round is already showing we leave it untouched.
  const onGameScreen = !$("game").classList.contains("hidden");
  if (!onGameScreen) show("wait");
});

socket.on("room:closed", ({ message }) => {
  sessionStorage.removeItem("pp_player");
  me = null;
  alert(message || "The host left. Game over.");
  show("join");
  $("joinBtn").disabled = false;
});

socket.on("lobby:return", () => {
  if (me) show("wait");
});

let winTarget = 0;
socket.on("game:intro", ({ game, winTarget: t }) => {
  winTarget = t || 0;
  show("game");
  $("pStage").innerHTML = `<div class="feedback"><div class="icon">${game.emoji}</div>
    <h2>${game.name}</h2><p class="tag">${game.description}</p>
    ${winTarget ? `<div class="rank-pill">🎯 Reach ${winTarget} pts to win</div>` : `<div class="rank-pill">Get ready…</div>`}</div>`;
});

function stopArcade() {
  if (roundState && roundState.arcade) {
    try { roundState.arcade.stop(); } catch {}
    roundState.arcade = null;
  }
}

/* ---------------- Round start ---------------- */
socket.on("round:start", (data) => {
  show("game");
  stopArcade();
  roundState = { mode: data.mode, gameId: data.gameId, submitted: false, taps: 0, tapTimer: null };
  const stage = $("pStage");

  if (data.mode === "quiz") renderQuiz(stage, data);
  else if (data.mode === "reaction") renderReactionWait(stage);
  else if (data.mode === "tap") renderTap(stage, data.duration);
  else if (data.mode === "arcade") renderArcade(stage, data);
});

/* ---------------- Arcade rendering ---------------- */
function renderArcade(stage, data) {
  stage.innerHTML = `<canvas id="arcadeCanvas" style="flex:1; width:100%; min-height:60vh; border-radius:12px; display:block; background:#0b0f17; touch-action:none;"></canvas>`;
  const canvas = $("arcadeCanvas");
  let lastEmit = 0;
  roundState.arcadeScore = 0;
  // Wait a frame so the canvas has its final layout size before we start.
  requestAnimationFrame(() => {
    roundState.arcade = window.Arcade.start(data.gameId, canvas, {
      duration: data.duration,
      onScore: (s) => {
        roundState.arcadeScore = s;
        const now = Date.now();
        if (now - lastEmit > 250) { lastEmit = now; socket.emit("player:submit", { score: s }); }
      },
      onEnd: (s) => {
        roundState.arcadeScore = s;
        socket.emit("player:submit", { score: s, done: true });
        setTimeout(() => waitingForOthers(), 700);
      },
    });
  });
}

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
  if (roundState && roundState.mode === "arcade") {
    stage.innerHTML = `<div class="feedback"><div class="icon">🎮</div>
      <div class="pts">${roundState.arcadeScore || 0}</div>
      <p class="tag"><span class="dots">Run over — waiting for others</span></p></div>`;
  } else if (roundState && roundState.mode === "tap") {
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
  stopArcade();
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
  } else if (roundState && roundState.mode === "arcade") {
    icon = "🎮"; headline = `${r.score ?? 0} this round`;
  }
  const rankTxt = rank === 1 ? "🥇 1st place!" : rank === 2 ? "🥈 2nd place" : rank === 3 ? "🥉 3rd place" : `#${rank} of ${total}`;
  const onTrack = winTarget ? (r.totalScore >= winTarget ? `<p class="tag" style="color:var(--good);">🎯 Target reached!</p>` : `<p class="tag">🎯 ${Math.max(0, winTarget - r.totalScore)} pts to target</p>`) : "";
  stage.innerHTML = `<div class="feedback ${good ? "good" : "bad"} fade-in">
    <div class="icon">${icon}</div>
    <h2>${headline}</h2>
    <div class="pts">+${r.points || 0}</div>
    <div class="rank-pill">${rankTxt}</div>
    <p class="tag">Total: ${r.totalScore} pts</p>${onTrack}</div>`;
});

/* ---------------- Game over ---------------- */
socket.on("game:over", ({ winner, leaderboard, qualified, target }) => {
  show("pGameover");
  stopArcade();
  const myRank = leaderboard.findIndex((p) => p.id === me?.playerId) + 1;
  const myEntry = leaderboard.find((p) => p.id === me?.playerId);
  const myScore = myEntry ? myEntry.score : 0;
  const iWon = qualified && winner && me && winner.id === me.playerId;
  $("overAv").textContent = me?.avatar || "🎉";

  if (iWon) {
    $("overTitle").textContent = "👑 You WON!";
    $("overRank").textContent = "Champion!";
    $("overScore").textContent = `${myScore} points · you cleared the ${target} target`;
    if (window.confettiBurst) { window.confettiBurst(220); setTimeout(() => window.confettiBurst(160), 900); }
  } else if (qualified && winner) {
    $("overTitle").textContent = "Game Over";
    $("overRank").textContent = myRank === 2 ? "🥈 2nd place" : myRank === 3 ? "🥉 3rd place" : `#${myRank} of ${leaderboard.length}`;
    $("overScore").textContent = `${myScore} points · Winner: ${winner.avatar} ${winner.name}`;
  } else {
    // Nobody crossed the target.
    $("overTitle").textContent = "So close!";
    $("overRank").textContent = `#${myRank} of ${leaderboard.length}`;
    $("overScore").textContent = `Nobody reached the ${target} pt target. You scored ${myScore}.`;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
