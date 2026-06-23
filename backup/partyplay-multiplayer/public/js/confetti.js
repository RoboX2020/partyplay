// Tiny dependency-free confetti burst.
(function () {
  const canvas = document.getElementById("confetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let parts = [];
  let raf = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const COLORS = ["#7c3aed", "#ec4899", "#22d3ee", "#22c55e", "#f59e0b", "#ef4444", "#ffd166"];

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.vy += 0.12;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    });
    parts = parts.filter((p) => p.y < canvas.height + 40);
    if (parts.length) raf = requestAnimationFrame(loop);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); raf = null; }
  }

  window.confettiBurst = function (count = 160) {
    resize();
    for (let i = 0; i < count; i++) {
      parts.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 3,
        s: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  };
})();
