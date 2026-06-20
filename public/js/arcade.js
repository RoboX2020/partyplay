/* ================================================================
   PartyPlay arcade games — canvas mini-games for the player phone.

   Arcade.start(gameId, canvas, opts) -> { stop() }
     opts.duration  : ms the round lasts
     opts.onScore(n): called as the score changes (throttle upstream)
     opts.onEnd(n)  : called once when the run ends (crash/out or time up)

   Each game is skill-based and ends either on failure or when time runs
   out. Visuals are intentionally retro/arcade.
   ================================================================ */
(function () {
  const Arcade = {};

  function setup(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(200, rect.width);
    const h = Math.max(320, rect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ============================================================ */
  /* Street Racer — dodge oncoming traffic                         */
  /* ============================================================ */
  function streetRacer(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;

    const roadX = w * 0.12, roadW = w * 0.76;
    const laneCount = 3;
    const laneW = roadW / laneCount;
    const car = { w: laneW * 0.62, h: laneW * 0.62 * 1.6 };
    car.x = roadX + roadW / 2 - car.w / 2;
    const carY = h - car.h - 22;
    let targetX = car.x;

    let speed = 0.28; // px per ms
    let dash = 0;
    let dist = 0;
    let dodged = 0;
    let score = 0;
    const enemies = [];
    let spawnTimer = 0;
    const colors = ["#3b82f6", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6"];

    function pointerX(e) {
      const r = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return Math.max(roadX, Math.min(roadX + roadW - car.w, cx - car.w / 2));
    }
    const move = (e) => { targetX = pointerX(e); e.preventDefault(); };
    canvas.addEventListener("pointermove", move, { passive: false });
    canvas.addEventListener("pointerdown", move, { passive: false });

    function spawn() {
      const lane = Math.floor(Math.random() * laneCount);
      const ex = roadX + lane * laneW + laneW * 0.19;
      enemies.push({ x: ex, y: -car.h, w: car.w, h: car.h, c: colors[(Math.random() * colors.length) | 0], scored: false });
    }

    function drawCar(x, y, color, flip) {
      ctx.fillStyle = color;
      roundRect(ctx, x, y, car.w, car.h, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      roundRect(ctx, x + car.w * 0.18, y + (flip ? car.h * 0.55 : car.h * 0.18), car.w * 0.64, car.h * 0.26, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.fillRect(x - 2, y + car.h * 0.2, 3, car.h * 0.18);
      ctx.fillRect(x + car.w - 1, y + car.h * 0.2, 3, car.h * 0.18);
    }

    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", move);
      opts.onEnd(Math.round(score));
    }

    let elapsedMs = 0;
    function frame(now) {
      const dt = Math.min(48, now - last);
      last = now;
      const elapsed = now - start;
      elapsedMs = elapsed;
      speed = 0.28 + elapsed / 26000 * 0.42; // ramps up

      // Move car toward target
      car.x += (targetX - car.x) * 0.25;

      // Spawn
      spawnTimer -= dt;
      const interval = Math.max(420, 900 - elapsed / 40);
      if (spawnTimer <= 0) { spawn(); spawnTimer = interval; }

      // Update enemies
      for (const en of enemies) {
        en.y += speed * dt;
        if (!en.scored && en.y > carY + car.h) { en.scored = true; dodged++; }
        // collision
        if (en.x < car.x + car.w - 6 && en.x + en.w > car.x + 6 && en.y < carY + car.h - 6 && en.y + en.h > carY + 6) {
          score = dodged * 25 + Math.floor(dist / 100);
          drawScene(true);
          return end();
        }
      }
      while (enemies.length && enemies[0].y > h) enemies.shift();

      dist += speed * dt;
      score = dodged * 25 + Math.floor(dist / 100);
      opts.onScore(Math.round(score));

      drawScene(false);

      if (elapsed >= opts.duration) { score = dodged * 25 + Math.floor(dist / 100); return end(); }
      raf = requestAnimationFrame(frame);
    }

    function drawScene(crashed) {
      // grass
      ctx.fillStyle = "#14532d";
      ctx.fillRect(0, 0, w, h);
      // road
      ctx.fillStyle = "#1f2430";
      ctx.fillRect(roadX, 0, roadW, h);
      // edges
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(roadX - 4, 0, 4, h);
      ctx.fillRect(roadX + roadW, 0, 4, h);
      // lane dashes
      dash = (dash + speed * 16) % 56;
      ctx.fillStyle = "rgba(255,255,255,.5)";
      for (let l = 1; l < laneCount; l++) {
        const lx = roadX + l * laneW - 2;
        for (let y = -56 + dash; y < h; y += 56) ctx.fillRect(lx, y, 4, 30);
      }
      for (const en of enemies) drawCar(en.x, en.y, en.c, true);
      drawCar(car.x, carY, crashed ? "#ef4444" : "#22d3ee", false);
      // HUD
      ctx.fillStyle = "#fff";
      ctx.font = "700 20px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Score " + Math.round(score), 12, 28);
      if (crashed) banner(ctx, w, h, "💥 CRASHED!", Math.round(score));
      else if (elapsedMs < 1600) {
        ctx.fillStyle = "rgba(0,0,0,.45)";
        ctx.fillRect(0, h / 2 - 26, w, 52);
        ctx.fillStyle = "#fff"; ctx.font = "700 22px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("Drag to steer", w / 2, h / 2 + 8);
      }
    }

    raf = requestAnimationFrame(frame);
    return { stop: end };
  }

  /* ============================================================ */
  /* Power Cricket — timing-based batting                          */
  /* ============================================================ */
  function powerCricket(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;

    const batLineY = h - 90;
    let runs = 0, wickets = 0, score = 0;
    let popup = null; // {text,color,t}
    let swing = 0;
    const ball = { x: w / 2, y: 40, r: 9, speed: 0.3 + Math.random() * 0.08, active: true, hit: false, judged: false };

    function resetBall() {
      ball.x = w / 2 + (Math.random() - 0.5) * w * 0.3;
      ball.y = 40;
      ball.speed = 0.3 + Math.random() * 0.12 + runs / 4000;
      ball.active = true; ball.hit = false; ball.judged = false;
    }

    function judge() {
      if (!ball.active || ball.judged) return;
      const diff = Math.abs(ball.y - batLineY);
      swing = 1;
      if (diff < 16) { runs += 6; popup = { text: "SIX! 🔥", color: "#f59e0b", t: 0 }; }
      else if (diff < 34) { runs += 4; popup = { text: "FOUR!", color: "#22c55e", t: 0 }; }
      else if (diff < 60) { runs += 2; popup = { text: "+2", color: "#67e8f9", t: 0 }; }
      else if (diff < 90) { runs += 1; popup = { text: "+1", color: "#cbd5e1", t: 0 }; }
      else { wickets++; popup = { text: "OUT! 🟥", color: "#ef4444", t: 0 }; }
      ball.judged = true; ball.active = false; ball.hit = diff < 90;
      score = runs;
      opts.onScore(score);
      setTimeout(() => { if (!ended && wickets < 3) resetBall(); }, 550);
      if (wickets >= 3) setTimeout(end, 900);
    }

    const tap = (e) => { e.preventDefault(); judge(); };
    canvas.addEventListener("pointerdown", tap, { passive: false });

    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", tap);
      opts.onEnd(score);
    }

    let elapsedMs = 0;
    function frame(now) {
      const dt = Math.min(48, now - last); last = now;
      const elapsed = now - start;
      elapsedMs = elapsed;

      if (ball.active) {
        ball.y += ball.speed * dt;
        if (ball.y > batLineY + 95) { // passed without a good hit
          ball.active = false;
          if (!ball.judged) { wickets++; popup = { text: "MISSED! 🟥", color: "#ef4444", t: 0 }; ball.judged = true; }
          if (wickets >= 3) setTimeout(end, 700);
          else setTimeout(() => { if (!ended) resetBall(); }, 500);
        }
      }
      if (swing > 0) swing = Math.max(0, swing - dt / 220);
      if (popup) { popup.t += dt; if (popup.t > 900) popup = null; }

      draw();
      if (elapsed >= opts.duration) return end();
      raf = requestAnimationFrame(frame);
    }

    function draw() {
      // field
      ctx.fillStyle = "#1c7a3e"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#218a47";
      for (let i = 0; i < h; i += 40) { if ((i / 40) % 2) { ctx.fillRect(0, i, w, 40); } }
      // pitch
      ctx.fillStyle = "#c9a36a";
      roundRect(ctx, w / 2 - 38, 20, 76, h - 40, 8); ctx.fill();
      // stumps
      ctx.fillStyle = "#f5f5f4";
      for (let s = -1; s <= 1; s++) ctx.fillRect(w / 2 + s * 7 - 1.5, 22, 3, 18);
      // bat line zone
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.fillRect(w / 2 - 50, batLineY - 16, 100, 32);
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w / 2 - 56, batLineY); ctx.lineTo(w / 2 + 56, batLineY); ctx.stroke();
      // batsman + bat
      const bx = w / 2 + 30, by = batLineY + 26;
      ctx.fillStyle = "#0f172a"; ctx.beginPath(); ctx.arc(bx, by, 12, 0, 7); ctx.fill();
      ctx.save();
      ctx.translate(bx, by + 6); ctx.rotate(-0.5 - swing * 1.2);
      ctx.fillStyle = "#b45309"; roundRect(ctx, -4, -6, 8, 46, 3); ctx.fill();
      ctx.restore();
      // ball
      if (ball.active || ball.hit) {
        ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0.4, 2.7); ctx.stroke();
      }
      // popup
      if (popup) {
        ctx.globalAlpha = Math.max(0, 1 - popup.t / 900);
        ctx.fillStyle = popup.color; ctx.font = "800 30px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(popup.text, w / 2, batLineY - 40 - popup.t / 20);
        ctx.globalAlpha = 1;
      }
      // HUD
      ctx.fillStyle = "#fff"; ctx.font = "800 22px Inter, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(runs + " runs", 12, 30);
      ctx.textAlign = "right"; ctx.fillStyle = "#fecaca";
      ctx.fillText("Wkts " + wickets + "/3", w - 12, 30);
      if (elapsedMs < 1700) {
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, h / 2 - 24, w, 48);
        ctx.fillStyle = "#fff"; ctx.font = "700 20px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("Tap when the ball hits the line!", w / 2, h / 2 + 7);
      }
    }

    raf = requestAnimationFrame(frame);
    return { stop: end };
  }

  /* ============================================================ */
  /* Sky Hopper — flappy-style                                     */
  /* ============================================================ */
  function skyHopper(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;

    const bird = { x: w * 0.28, y: h / 2, r: 13, vy: 0 };
    const grav = 0.0016 * h;
    const flap = -0.032 * h;
    const groundH = 28;
    const pipes = [];
    const gap = Math.max(135, h * 0.26);
    const pipeW = 56;
    let pipeTimer = 0;
    let score = 0;
    let started = false;

    function addPipe() {
      const top = 40 + Math.random() * (h - groundH - gap - 80);
      pipes.push({ x: w + 10, top, passed: false });
    }

    const tap = (e) => { e.preventDefault(); started = true; bird.vy = flap; };
    canvas.addEventListener("pointerdown", tap, { passive: false });

    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", tap);
      opts.onEnd(score);
    }

    function frame(now) {
      const dt = Math.min(48, now - last); last = now;
      const elapsed = now - start;
      const sp = (0.18 + elapsed / 30000 * 0.12) * w / 10; // px/frame-ish scaled

      if (started) {
        bird.vy += grav * (dt / 16);
        bird.y += bird.vy * (dt / 16);
        pipeTimer -= dt;
        if (pipeTimer <= 0) { addPipe(); pipeTimer = 1500; }
        for (const p of pipes) {
          p.x -= sp * (dt / 16);
          if (!p.passed && p.x + pipeW < bird.x) { p.passed = true; score++; opts.onScore(score); }
          // collision
          if (bird.x + bird.r > p.x && bird.x - bird.r < p.x + pipeW) {
            if (bird.y - bird.r < p.top || bird.y + bird.r > p.top + gap) { draw(true); return end(); }
          }
        }
        while (pipes.length && pipes[0].x + pipeW < -10) pipes.shift();
        if (bird.y + bird.r > h - groundH || bird.y - bird.r < 0) { draw(true); return end(); }
      }

      draw(false);
      if (elapsed >= opts.duration) return end();
      raf = requestAnimationFrame(frame);
    }

    function draw(dead) {
      // sky
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#38bdf8"); g.addColorStop(1, "#7dd3fc");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // pipes
      for (const p of pipes) {
        ctx.fillStyle = "#16a34a";
        ctx.fillRect(p.x, 0, pipeW, p.top);
        ctx.fillRect(p.x, p.top + gap, pipeW, h - groundH - (p.top + gap));
        ctx.fillStyle = "#15803d";
        ctx.fillRect(p.x - 3, p.top - 16, pipeW + 6, 16);
        ctx.fillRect(p.x - 3, p.top + gap, pipeW + 6, 16);
      }
      // ground
      ctx.fillStyle = "#ca8a04"; ctx.fillRect(0, h - groundH, w, groundH);
      ctx.fillStyle = "#a16207"; for (let x = 0; x < w; x += 18) ctx.fillRect(x, h - groundH, 9, groundH);
      // bird
      ctx.save(); ctx.translate(bird.x, bird.y);
      ctx.rotate(Math.max(-0.5, Math.min(1, bird.vy * 0.04)));
      ctx.fillStyle = dead ? "#ef4444" : "#facc15";
      ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, 7); ctx.fill();
      ctx.fillStyle = "#f97316"; ctx.beginPath(); ctx.moveTo(bird.r - 2, -2); ctx.lineTo(bird.r + 7, 1); ctx.lineTo(bird.r - 2, 4); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(4, -5, 3.4, 0, 7); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(5, -5, 1.6, 0, 7); ctx.fill();
      ctx.restore();
      // HUD
      ctx.fillStyle = "#0f172a"; ctx.font = "800 30px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(score, w / 2, 44);
      if (!started) {
        ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(0, h / 2 - 26, w, 52);
        ctx.fillStyle = "#fff"; ctx.font = "700 22px Inter, sans-serif";
        ctx.fillText("Tap to fly!", w / 2, h / 2 + 8);
      }
      if (dead) banner(ctx, w, h, "💥", score);
    }

    raf = requestAnimationFrame(frame);
    return { stop: end };
  }

  function banner(ctx, w, h, title, score) {
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, h / 2 - 60, w, 120);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.font = "800 34px Inter, sans-serif";
    ctx.fillText(title, w / 2, h / 2 - 8);
    ctx.font = "700 22px Inter, sans-serif";
    ctx.fillText("Score: " + score, w / 2, h / 2 + 30);
  }

  const GAMES = { race: streetRacer, cricket: powerCricket, flappy: skyHopper };

  Arcade.start = function (gameId, canvas, opts) {
    const fn = GAMES[gameId];
    if (!fn) { opts.onEnd(0); return { stop() {} }; }
    return fn(canvas, opts);
  };

  window.Arcade = Arcade;
})();
