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
    // Gentler, more forgiving tuning.
    const grav = 0.0010 * h;
    const flap = -0.026 * h;
    const groundH = 28;
    const pipes = [];
    const gap = Math.max(190, h * 0.36);
    const pipeW = 52;
    let pipeTimer = 0;
    let score = 0;
    let started = false;

    function addPipe() {
      const top = 45 + Math.random() * Math.max(40, h - groundH - gap - 110);
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
      const sp = (0.13 + elapsed / 45000 * 0.07) * w / 10; // slower + gentler ramp

      if (started) {
        bird.vy += grav * (dt / 16);
        bird.y += bird.vy * (dt / 16);
        pipeTimer -= dt;
        if (pipeTimer <= 0) { addPipe(); pipeTimer = 2000; }
        const hit = bird.r - 4; // forgiving hitbox
        for (const p of pipes) {
          p.x -= sp * (dt / 16);
          if (!p.passed && p.x + pipeW < bird.x) { p.passed = true; score++; opts.onScore(score); }
          // collision
          if (bird.x + hit > p.x && bird.x - hit < p.x + pipeW) {
            if (bird.y - hit < p.top || bird.y + hit > p.top + gap) { draw(true); return end(); }
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

  /* ============================================================ */
  /* Gravity Run — flip gravity to dodge blocks                    */
  /* ============================================================ */
  function gravityRun(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;

    const wallH = 22;
    const size = 26;
    const floorY = h - wallH - size;
    const ceilY = wallH;
    let onFloor = true;
    let py = floorY;
    let vy = 0;
    const grav = 0.0026 * h;
    let score = 0;
    let started = false;
    let elapsedMs = 0;
    const px = w * 0.24;
    const blocks = [];
    let spawnTimer = 600;
    let gridX = 0;

    const tap = (e) => { e.preventDefault(); started = true; onFloor = !onFloor; };
    canvas.addEventListener("pointerdown", tap, { passive: false });

    function spawn() {
      // A block on the floor or the ceiling that you must avoid by being on
      // the opposite surface.
      const top = Math.random() < 0.5;
      const bh = size + Math.random() * size * 1.4;
      blocks.push({ x: w + 20, top, h: bh, w: 26 + Math.random() * 16, passed: false });
    }

    function end() {
      if (ended) return; ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", tap);
      opts.onEnd(score);
    }

    function frame(now) {
      const dt = Math.min(48, now - last); last = now;
      elapsedMs = now - start;
      const sp = (0.2 + elapsedMs / 30000 * 0.16) * w / 10;
      gridX = (gridX - sp * (dt / 16)) % 40;

      if (started) {
        const target = onFloor ? floorY : ceilY;
        const dir = onFloor ? 1 : -1;
        vy += grav * dir * (dt / 16);
        py += vy * (dt / 16);
        if (onFloor && py >= floorY) { py = floorY; vy = 0; }
        if (!onFloor && py <= ceilY) { py = ceilY; vy = 0; }

        spawnTimer -= dt;
        if (spawnTimer <= 0) { spawn(); spawnTimer = Math.max(620, 1150 - elapsedMs / 40); }
        for (const b of blocks) {
          b.x -= sp * (dt / 16);
          if (!b.passed && b.x + b.w < px) { b.passed = true; score++; opts.onScore(score); }
          const by = b.top ? wallH : h - wallH - b.h;
          if (px + size - 5 > b.x && px + 5 < b.x + b.w && py + size - 5 > by && py + 5 < by + b.h) {
            draw(true); return end();
          }
        }
        while (blocks.length && blocks[0].x + blocks[0].w < -10) blocks.shift();
      }

      draw(false);
      if (elapsedMs >= opts.duration) return end();
      raf = requestAnimationFrame(frame);
    }

    function draw(dead) {
      ctx.fillStyle = "#0b1020"; ctx.fillRect(0, 0, w, h);
      // moving grid
      ctx.strokeStyle = "rgba(139,92,246,.18)"; ctx.lineWidth = 1;
      for (let x = gridX; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, wallH); ctx.lineTo(x, h - wallH); ctx.stroke(); }
      // walls
      ctx.fillStyle = "#312e81"; ctx.fillRect(0, 0, w, wallH); ctx.fillRect(0, h - wallH, w, wallH);
      // blocks
      for (const b of blocks) {
        ctx.fillStyle = "#a855f7";
        const by = b.top ? wallH : h - wallH - b.h;
        ctx.fillRect(b.x, by, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(b.x, by, b.w, 4);
      }
      // player
      ctx.fillStyle = dead ? "#ef4444" : "#22d3ee";
      roundRect(ctx, px, py, size, size, 5); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(px + 6, py + 8, 5, 5); ctx.fillRect(px + size - 11, py + 8, 5, 5);
      // HUD
      ctx.fillStyle = "#fff"; ctx.font = "800 22px Inter, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("Score " + score, 12, 16 + 4);
      if (!started) {
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, h / 2 - 26, w, 52);
        ctx.fillStyle = "#fff"; ctx.font = "700 20px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("Tap to flip gravity!", w / 2, h / 2 + 7);
      }
      if (dead) banner(ctx, w, h, "💥", score);
    }

    raf = requestAnimationFrame(frame);
    return { stop: end };
  }

  /* ============================================================ */
  /* Stack Tower — drop moving blocks to build a tower             */
  /* ============================================================ */
  function stackTower(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;

    const blockH = 30;
    const baseW = w * 0.5;
    const stack = [{ x: w / 2 - baseW / 2, w: baseW }];
    let score = 0;
    let dir = 1;
    let speed = 0.22 * w / 10;
    const cur = { x: 0, w: baseW };
    let scrollY = 0; // grows as the tower rises
    let elapsedMs = 0;
    const hueBase = Math.floor(Math.random() * 360);

    function topY() { return h - 60 - stack.length * blockH + scrollY; }

    function drop() {
      const prev = stack[stack.length - 1];
      const left = Math.max(cur.x, prev.x);
      const right = Math.min(cur.x + cur.w, prev.x + prev.w);
      const overlap = right - left;
      if (overlap <= 2) { draw(true); return end(); } // missed the tower
      stack.push({ x: left, w: overlap });
      cur.w = overlap;
      score++;
      opts.onScore(score);
      speed += 0.01 * w / 10;
      cur.x = (score % 2 === 0) ? -cur.w : w;
      dir = (score % 2 === 0) ? 1 : -1;
      // scroll up so the active row stays in view
      if (stack.length > 7) scrollY += blockH;
    }

    const tap = (e) => { e.preventDefault(); drop(); };
    canvas.addEventListener("pointerdown", tap, { passive: false });

    function end() {
      if (ended) return; ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", tap);
      opts.onEnd(score);
    }

    cur.x = w; dir = -1;
    function frame(now) {
      const dt = Math.min(48, now - last); last = now;
      elapsedMs = now - start;
      cur.x += dir * speed * (dt / 16);
      if (cur.x < -cur.w + 4) { cur.x = -cur.w + 4; dir = 1; }
      if (cur.x > w - 4) { cur.x = w - 4; dir = -1; }
      draw(false);
      if (elapsedMs >= opts.duration) return end();
      raf = requestAnimationFrame(frame);
    }

    function draw(dead) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#0e1726"); g.addColorStop(1, "#15233b");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // stack
      for (let i = 0; i < stack.length; i++) {
        const b = stack[i];
        const y = h - 60 - i * blockH + scrollY;
        if (y > h || y < -blockH) continue;
        ctx.fillStyle = `hsl(${(hueBase + i * 24) % 360} 65% 55%)`;
        roundRect(ctx, b.x, y, b.w, blockH - 3, 4); ctx.fill();
      }
      // moving block
      const my = topY();
      ctx.fillStyle = `hsl(${(hueBase + stack.length * 24) % 360} 70% 60%)`;
      roundRect(ctx, cur.x, my, cur.w, blockH - 3, 4); ctx.fill();
      // HUD
      ctx.fillStyle = "#fff"; ctx.font = "800 24px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(score, w / 2, 40);
      if (score === 0 && elapsedMs < 2200) {
        ctx.font = "700 18px Inter, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.9)";
        ctx.fillText("Tap to drop the block", w / 2, 70);
      }
      if (dead) banner(ctx, w, h, "🧱 Toppled!", score);
    }

    raf = requestAnimationFrame(frame);
    return { stop: end };
  }

  /* ============================================================ */
  /* Brick Breaker — paddle + ball + bricks                        */
  /* ============================================================ */
  function brickBreaker(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    let raf, ended = false;
    const start = performance.now();
    let last = start;
    let elapsedMs = 0;

    const paddle = { w: w * 0.26, h: 14, x: w / 2 };
    const padY = h - 40;
    const ball = { x: w / 2, y: padY - 16, r: 8, vx: 0.18 * w / 10, vy: -0.22 * h / 10 };
    let lives = 3, score = 0, started = false;
    const cols = 6, rows = 4, pad = 6;
    const brickW = (w - pad * (cols + 1)) / cols;
    const brickH = 20;
    let bricks = [];

    function makeBricks() {
      bricks = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          bricks.push({ x: pad + c * (brickW + pad), y: 50 + r * (brickH + pad), w: brickW, h: brickH, hue: 200 + r * 30, alive: true });
    }
    makeBricks();

    function move(e) {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      paddle.x = Math.max(paddle.w / 2, Math.min(w - paddle.w / 2, cx));
      started = true;
      e.preventDefault();
    }
    canvas.addEventListener("pointermove", move, { passive: false });
    canvas.addEventListener("pointerdown", move, { passive: false });

    function end() {
      if (ended) return; ended = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", move);
      opts.onEnd(score);
    }

    function frame(now) {
      const dt = Math.min(40, now - last); last = now; elapsedMs = now - start;
      if (started) {
        const k = dt / 16;
        ball.x += ball.vx * k; ball.y += ball.vy * k;
        if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
        if (ball.x + ball.r > w) { ball.x = w - ball.r; ball.vx *= -1; }
        if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -1; }
        // paddle
        if (ball.y + ball.r >= padY && ball.y + ball.r <= padY + paddle.h + 6 && ball.x > paddle.x - paddle.w / 2 && ball.x < paddle.x + paddle.w / 2 && ball.vy > 0) {
          ball.vy *= -1;
          ball.vx += (ball.x - paddle.x) / paddle.w * 0.5 * w / 10;
        }
        // bricks
        for (const b of bricks) {
          if (!b.alive) continue;
          if (ball.x > b.x && ball.x < b.x + b.w && ball.y - ball.r < b.y + b.h && ball.y + ball.r > b.y) {
            b.alive = false; ball.vy *= -1; score++; opts.onScore(score); break;
          }
        }
        if (!bricks.some((b) => b.alive)) { makeBricks(); ball.vy = -Math.abs(ball.vy) * 1.02; }
        // fell off
        if (ball.y - ball.r > h) {
          lives--;
          if (lives <= 0) { draw(true); return end(); }
          ball.x = paddle.x; ball.y = padY - 16; ball.vx = 0.18 * w / 10; ball.vy = -0.22 * h / 10; started = false;
        }
      }
      draw(false);
      if (elapsedMs >= opts.duration) return end();
      raf = requestAnimationFrame(frame);
    }

    function draw(dead) {
      ctx.fillStyle = "#0a0f1a"; ctx.fillRect(0, 0, w, h);
      for (const b of bricks) {
        if (!b.alive) continue;
        ctx.fillStyle = `hsl(${b.hue} 70% 55%)`;
        roundRect(ctx, b.x, b.y, b.w, b.h, 3); ctx.fill();
      }
      // paddle
      ctx.fillStyle = "#22d3ee"; roundRect(ctx, paddle.x - paddle.w / 2, padY, paddle.w, paddle.h, 7); ctx.fill();
      // ball
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
      // HUD
      ctx.fillStyle = "#fff"; ctx.font = "800 20px Inter, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("Score " + score, 12, 26);
      ctx.textAlign = "right"; ctx.fillStyle = "#fca5a5";
      ctx.fillText("♥".repeat(Math.max(0, lives)), w - 12, 26);
      if (!started && !dead) {
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, h / 2 - 24, w, 48);
        ctx.fillStyle = "#fff"; ctx.font = "700 19px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("Slide to move the paddle", w / 2, h / 2 + 6);
      }
      if (dead) banner(ctx, w, h, "💥 Game Over", score);
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

  const GAMES = {
    race: streetRacer,
    cricket: powerCricket,
    flappy: skyHopper,
    gravity: gravityRun,
    stack: stackTower,
    brick: brickBreaker,
  };

  Arcade.start = function (gameId, canvas, opts) {
    const fn = GAMES[gameId];
    if (!fn) { opts.onEnd(0); return { stop() {} }; }
    return fn(canvas, opts);
  };

  window.Arcade = Arcade;
})();
