const socket = io();

const SHAPES = ["▲", "◆", "●", "■"];
const $ = (id) => document.getElementById(id);
const sections = ["lobby", "intro", "play", "result", "gameover"];
function show(id) {
  sections.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

let selectedGame = null;
let games = [];
let timerInt = null;
let currentMode = null;

/* ---------------- Connection status ---------------- */
function setNet(visible, msg, bad) {
  const b = $("netBanner");
  b.classList.toggle("show", visible);
  b.classList.toggle("bad", !!bad);
  if (msg) $("netMsg").textContent = msg;
}
// Show "connecting" right away — important on cold starts (free hosting can
// take ~30–60s to wake up), so the screen never looks silently broken.
setNet(true, "Connecting to server…");

socket.on("connect", () => {
  setNet(false);
  const code = sessionStorage.getItem("pp_host_code");
  if (code) socket.emit("host:reattach", { code, origin: window.location.origin });
  else socket.emit("host:create", { origin: window.location.origin });
});
socket.on("disconnect", () => setNet(true, "Connection lost — reconnecting…", true));
socket.io.on("reconnect_attempt", () => setNet(true, "Reconnecting…", true));

function applyRoomData(data) {
  $("roomCode").textContent = data.code;
  $("qr").src = data.qr || "";
  $("joinUrl").textContent = (data.joinUrl || "").replace(/^https?:\/\//, "");
  sessionStorage.setItem("pp_host_code", data.code);
  games = data.games;
  renderGamePicker();
  renderPlayers(data.players);
}

socket.on("host:created", (data) => {
  applyRoomData(data);
  show("lobby");
});

socket.on("host:reattached", (data) => {
  applyRoomData(data);
  if (data.state === "lobby" || data.state === "gameover") {
    show("lobby");
  } else {
    // Game in progress — show current standings until the next round event
    // re-renders the live stage.
    $("resultRoundLabel").textContent = "Reconnected — game in progress";
    $("resultReveal").innerHTML = "";
    renderLeaderboard($("leaderboard"), data.leaderboard || []);
    show("result");
  }
});

socket.on("host:reattachFailed", () => {
  sessionStorage.removeItem("pp_host_code");
  socket.emit("host:create", { origin: window.location.origin });
});

socket.on("room:players", ({ players }) => renderPlayers(players));
socket.on("host:error", ({ message }) => alert(message));
socket.on("room:closed", ({ message }) => {
  sessionStorage.removeItem("pp_host_code");
  alert(message || "Room closed.");
  socket.emit("host:create", { origin: window.location.origin });
});

function renderPlayers(players) {
  const el = $("players");
  $("playerCount").textContent = players.length;
  $("playerCount2").textContent = players.length;
  if (!players.length) {
    el.innerHTML = `<div class="empty-hint">Waiting for players to scan the QR code…</div>`;
  } else {
    el.innerHTML = players
      .map(
        (p) => `<div class="player-chip pop ${p.connected ? "" : "off"}">
          <span class="av">${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`
      )
      .join("");
  }
  $("startBtn").disabled = !(players.length > 0 && selectedGame);
}

function renderGamePicker() {
  $("gamePicker").innerHTML = games
    .map(
      (g) => `<div class="game-tile" data-id="${g.id}" style="--c:${g.color}">
        <div class="ge">${g.emoji}</div>
        <h4>${g.name}</h4>
        <p>${g.description}</p>
        <div class="rounds">${g.rounds} rounds · ${g.mode}</div>
      </div>`
    )
    .join("");
  document.querySelectorAll(".game-tile").forEach((t) => {
    t.addEventListener("click", () => {
      selectedGame = t.dataset.id;
      document.querySelectorAll(".game-tile").forEach((x) => x.classList.toggle("sel", x === t));
      $("startBtn").disabled = $("players").querySelector(".player-chip") == null;
    });
  });
}

$("startBtn").addEventListener("click", () => {
  if (!selectedGame) return;
  socket.emit("host:start", { gameId: selectedGame });
});

$("playAgainBtn").addEventListener("click", () => socket.emit("host:playAgain"));

socket.on("lobby:return", ({ players, games: g }) => {
  games = g;
  selectedGame = null;
  renderGamePicker();
  renderPlayers(players);
  show("lobby");
});

/* ---------------- Intro splash ---------------- */
let currentGame = null;
socket.on("game:intro", ({ game, rounds, winTarget }) => {
  currentMode = null;
  currentGame = { ...game, winTarget: winTarget || 0 };
  $("introEmoji").textContent = game.emoji;
  $("introName").textContent = game.name;
  $("introDesc").textContent = game.description;
  $("gameNamePill").textContent = `${game.emoji} ${game.name}`;
  show("intro");
  let n = 3;
  const cd = $("introCountdown");
  cd.textContent = "Get ready!";
  setTimeout(() => {
    cd.classList.add("pop");
    const tick = () => {
      cd.textContent = n > 0 ? n : "GO!";
      cd.classList.remove("pop");
      void cd.offsetWidth;
      cd.classList.add("pop");
      n--;
      if (n >= -1) setTimeout(tick, 800);
    };
    tick();
  }, 600);
});

/* ---------------- Round start ---------------- */
socket.on("round:start", (data) => {
  currentMode = data.mode;
  show("play");
  $("roundLabel").textContent = `Round ${data.round} of ${data.totalRounds}`;
  $("answersCount").textContent = targetLine();
  stopTimer();

  const content = $("stageContent");
  if (data.mode === "quiz") {
    renderQuiz(content, data);
    startTimer(data.duration);
  } else if (data.mode === "reaction") {
    content.innerHTML = `<div class="big-msg">⚡ Get Ready…</div>
      <p class="tag">Tell players to watch their phones. Tap when it turns GREEN!</p>`;
    $("timer").textContent = "•";
    setBar(100);
  } else if (data.mode === "tap") {
    content.innerHTML = `<div class="big-msg" id="tapMsg">👆 TAP! TAP! TAP!</div>
      <p class="tag">Players are tapping as fast as they can!</p>`;
    startTimer(data.duration);
  } else if (data.mode === "arcade") {
    const g = currentGame || {};
    content.innerHTML = `<div style="font-size:5rem;">${g.emoji || "🎮"}</div>
      <div class="big-msg">${escapeHtml(g.name || "Playing")} — live!</div>
      <p class="tag">Everyone's playing on their phones. ${g.winTarget ? `First past <b>${g.winTarget}</b> total points qualifies to win.` : ""}</p>`;
    startTimer(data.duration);
  }
});

function targetLine() {
  return currentGame && currentGame.winTarget ? `🎯 Target to win: ${currentGame.winTarget} pts` : "";
}

socket.on("round:answered", ({ count, total, label }) => {
  if (currentMode === "tap") return;
  const word = label === "finished" ? "finished" : "answered";
  $("answersCount").textContent = `✋ ${count} / ${total} ${word}`;
});

socket.on("round:go", () => {
  if (currentMode !== "reaction") return;
  const content = $("stageContent");
  content.innerHTML = `<div class="big-msg" style="color:#22c55e; font-size:6rem;">GO! ⚡</div>
    <p class="tag">Fastest reaction wins!</p>`;
});

function renderQuiz(content, data) {
  const v = data.view;
  if (data.gameId === "color") {
    // Stroop: big word drawn in ink color; options are color swatches.
    content.innerHTML = `
      <div class="stroop-word" style="color:${v.inkHex}">${v.word}</div>
      <p class="tag" style="margin-bottom:10px;">What COLOR is the word printed in?</p>
      <div class="host-options" id="hostOpts"></div>`;
    $("hostOpts").innerHTML = v.options
      .map(
        (o, i) => `<div class="host-opt" data-i="${i}" style="background:${o.hex}">
          <span class="shape">${SHAPES[i]}</span><span>${o.name}</span></div>`
      )
      .join("");
  } else {
    content.innerHTML = `
      <div class="prompt-big">${escapeHtml(v.prompt)}</div>
      <div class="host-options" id="hostOpts"></div>`;
    $("hostOpts").innerHTML = v.options
      .map(
        (o, i) => `<div class="host-opt c${i}" data-i="${i}">
          <span class="shape">${SHAPES[i]}</span><span>${escapeHtml(o)}</span></div>`
      )
      .join("");
  }
}

/* ---------------- Round result ---------------- */
socket.on("round:result", ({ round, totalRounds, mode, reveal, leaderboard }) => {
  stopTimer();
  show("result");
  $("resultRoundLabel").textContent = `Round ${round} of ${totalRounds} results`;
  const rev = $("resultReveal");

  if (mode === "quiz") {
    // Highlight correct answer on the still-rendered options if present.
    const total = Math.max(1, reveal.answeredCount);
    rev.innerHTML = `<div class="host-options" style="max-width:760px; margin:0 auto;">
      ${(reveal.distribution || [])
        .map((cnt, i) => {
          const isCorrect = i === reveal.correctIndex;
          return `<div class="host-opt c${i} ${isCorrect ? "correct" : "dim"}">
            <span class="shape">${SHAPES[i]}</span>
            <span class="dist">${cnt}</span></div>`;
        })
        .join("")}
    </div>
    <p class="tag" style="margin-top:14px;">✅ ${reveal.correctCount}/${reveal.answeredCount} got it right</p>`;
  } else if (mode === "reaction") {
    rev.innerHTML = `<div class="big-msg" style="font-size:2.4rem;">⚡ Fastest: ${
      reveal.bestMs != null ? reveal.bestMs + " ms" : "—"
    }</div>`;
  } else if (mode === "tap") {
    rev.innerHTML = `<div class="big-msg" style="font-size:2.4rem;">👆 Most taps: ${reveal.bestTaps}</div>`;
  } else if (mode === "arcade") {
    rev.innerHTML = `<div class="big-msg" style="font-size:2.4rem;">${currentGame?.emoji || "🎮"} Best this round: ${reveal.bestScore}</div>
      ${currentGame?.winTarget ? `<p class="tag" style="margin-top:8px;">🎯 ${currentGame.winTarget} total points needed to win</p>` : ""}`;
  }

  renderLeaderboard($("leaderboard"), leaderboard);
});

function renderLeaderboard(el, board) {
  el.innerHTML = board
    .map((p, i) => {
      const topCls = i < 3 ? `top${i + 1}` : "";
      const medal = ["🥇", "🥈", "🥉"][i] || i + 1;
      return `<div class="lb-row ${topCls}">
        <span class="rank">${medal}</span>
        <span class="av">${p.avatar}</span>
        <span class="nm">${escapeHtml(p.name)}</span>
        <span class="sc">${p.score}</span></div>`;
    })
    .join("");
}

/* ---------------- Game over ---------------- */
socket.on("game:over", ({ winner, leaderboard, qualified, target, topPlayer }) => {
  show("gameover");
  renderPodium(leaderboard);
  renderLeaderboard($("finalBoard"), leaderboard);

  if (qualified && winner) {
    $("gameoverCrown").textContent = "🏆";
    $("gameoverTitle").textContent = "We have a winner";
    $("winnerName").textContent = `${winner.avatar} ${winner.name} — ${winner.score} pts`;
    if (window.confettiBurst) {
      window.confettiBurst(220);
      setTimeout(() => window.confettiBurst(160), 800);
      setTimeout(() => window.confettiBurst(160), 1700);
    }
  } else {
    // Nobody crossed the qualifying target.
    $("gameoverCrown").textContent = "🎯";
    $("gameoverTitle").textContent = "No winner this time";
    $("winnerName").innerHTML = topPlayer
      ? `Nobody reached the <b>${target}</b> pt target.<br><span style="font-size:.7em; color:var(--muted);">Closest: ${topPlayer.avatar} ${escapeHtml(topPlayer.name)} with ${topPlayer.score} pts</span>`
      : `Nobody reached the ${target} pt target.`;
  }
});

function renderPodium(board) {
  const order = [board[1], board[0], board[2]]; // 2nd, 1st, 3rd
  const place = [2, 1, 3];
  $("podium").innerHTML = order
    .map((p, idx) => {
      if (!p) return "";
      const pl = place[idx];
      return `<div class="pod p${pl} pop">
        ${pl === 1 ? '<div class="crown">👑</div>' : ""}
        <div class="av">${p.avatar}</div>
        <div class="bar">${pl}</div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="sc">${p.score} pts</div></div>`;
    })
    .join("");
}

/* ---------------- Timer ---------------- */
function startTimer(duration) {
  stopTimer();
  const end = Date.now() + duration;
  const update = () => {
    const left = Math.max(0, end - Date.now());
    $("timer").textContent = Math.ceil(left / 1000);
    setBar((left / duration) * 100);
    if (left <= 0) stopTimer();
  };
  update();
  timerInt = setInterval(update, 100);
}
function stopTimer() {
  if (timerInt) clearInterval(timerInt);
  timerInt = null;
}
function setBar(pct) {
  $("timerFill").style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
