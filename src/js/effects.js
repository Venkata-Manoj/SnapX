const W = 240;
const H = 300;
const LOOP = 4;

export function initEffects() {
  const nodes = [...document.querySelectorAll('[data-effect]')];
  if (!nodes.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = nodes.map((canvas) => setup(canvas));
  if (reduced) {
    items.forEach((item) => item.draw(1.35));
    return;
  }

  let raf = 0;

  function tick(now) {
    raf = 0;
    let alive = false;
    for (const item of items) {
      if (!item.running) continue;
      alive = true;
      const elapsed = (now - item.start) / 1000;
      if (item.once && elapsed >= LOOP) {
        item.running = false;
        item.once = false;
        item.draw(0);
        continue;
      }
      item.draw(elapsed % LOOP);
    }
    if (alive) raf = window.requestAnimationFrame(tick);
  }

  function ensure() {
    if (!raf) raf = window.requestAnimationFrame(tick);
  }

  for (const item of items) {
    const host = item.canvas.closest('.effect');
    if (!host) continue;

    const play = (once) => {
      item.running = true;
      item.once = once;
      item.start = performance.now();
      ensure();
    };
    const rest = () => {
      item.running = false;
      item.once = false;
      item.draw(0);
    };

    host.addEventListener('pointerenter', () => play(false));
    host.addEventListener('pointerleave', rest);
    host.addEventListener('focusin', () => play(false));
    host.addEventListener('focusout', rest);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || item.seen) return;
          item.seen = true;
          play(true);
          observer.disconnect();
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(host);
  }
}

function setup(canvas) {
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const type = canvas.dataset.effect;
  const particles = type === 'dust' || type === 'ember' ? sample(4) : null;

  return {
    canvas,
    type,
    particles,
    running: false,
    once: false,
    seen: false,
    start: 0,
    draw(t) {
      ctx.clearRect(0, 0, W, H);
      drawRoom(ctx);
      if (type === 'dust') drawDust(ctx, particles, t);
      else if (type === 'ember') drawEmber(ctx, particles, t);
      else if (type === 'glitch') drawGlitch(ctx, t);
      else if (type === 'portal') drawPortal(ctx, t);
      else drawFade(ctx, t);
      ctx.globalAlpha = 1;
    },
  };
}

function sample(step) {
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const ctx = mask.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  person(ctx);
  const data = ctx.getImageData(0, 0, W, H).data;
  const points = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4 + 3] > 128) {
        points.push({
          x: x + 0.5,
          y: y + 0.5,
          nx: x / W,
          rand: Math.random(),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }
  return points;
}

function person(ctx) {
  ctx.beginPath();
  ctx.arc(120, 118, 32, 0, Math.PI * 2);
  ctx.rect(106, 140, 28, 28);
  ctx.moveTo(46, H);
  ctx.bezierCurveTo(50, 238, 82, 206, 120, 206);
  ctx.bezierCurveTo(158, 206, 190, 238, 194, H);
  ctx.closePath();
  ctx.fill();
}

function drawRoom(ctx) {
  ctx.fillStyle = '#D9D1C4';
  ctx.fillRect(0, 0, W, H);

  const light = ctx.createRadialGradient(54, 18, 0, 54, 18, 190);
  light.addColorStop(0, 'rgba(245,242,236,0.32)');
  light.addColorStop(1, 'rgba(245,242,236,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#E8E2D6';
  ctx.fillRect(16, 46, 66, 88);
  ctx.strokeStyle = 'rgba(30,27,23,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 46, 66, 88);
  ctx.beginPath();
  ctx.moveTo(49, 46);
  ctx.lineTo(49, 134);
  ctx.moveTo(16, 90);
  ctx.lineTo(82, 90);
  ctx.stroke();

  ctx.fillStyle = 'rgba(245,242,236,0.3)';
  ctx.fillRect(20, 46, 9, 88);

  ctx.fillStyle = '#BFB4A3';
  ctx.fillRect(164, 100, 60, 5);
  const books = [
    [172, 78, 7, 22, '#8C7F6E'],
    [182, 70, 6, 30, '#A39682'],
    [191, 82, 8, 18, '#6E6253'],
  ];
  for (const [x, y, w, h, color] of books) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  ctx.fillStyle = '#BFB4A3';
  ctx.beginPath();
  ctx.moveTo(202, 258);
  ctx.lineTo(226, 258);
  ctx.lineTo(222, 274);
  ctx.lineTo(206, 274);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7C8A6A';
  ctx.beginPath();
  ctx.ellipse(208, 244, 6, 14, -0.6, 0, Math.PI * 2);
  ctx.ellipse(217, 240, 6, 16, 0.3, 0, Math.PI * 2);
  ctx.ellipse(222, 250, 5, 11, 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(30,27,23,0.06)';
  ctx.fillRect(0, 280, W, 20);

  const vignette = ctx.createRadialGradient(120, 140, 40, 120, 150, 190);
  vignette.addColorStop(0, 'rgba(30,27,23,0)');
  vignette.addColorStop(1, 'rgba(30,27,23,0.16)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

function drawDust(ctx, points, t) {
  ctx.fillStyle = '#1E1B17';
  if (t < 0.4 || t > 3.85) {
    person(ctx);
    return;
  }

  for (const point of points) {
    let x = point.x;
    let y = point.y;
    let alpha = 1;
    let size = 5;
    let vermillion = point.rand < 0.06;

    if (t < 2.6) {
      const start = 0.4 + point.nx * 0.6 + point.rand * 0.15;
      const p = (t - start) / 0.85;
      if (p >= 1) continue;
      if (p > 0) {
        x += (40 + point.rand * 90) * p * 0.8 + Math.sin(t * 5 + point.phase) * 5 * p;
        y -= (20 + point.rand * 50) * p * 0.8;
        alpha = 1 - p;
        size = 5 * (1 - 0.7 * p);
      }
    } else {
      const start = 2.6 + (1 - point.nx) * 0.4 + point.rand * 0.15;
      const p = (t - start) / 0.75;
      if (p <= 0) continue;
      if (p < 1) {
        const ease = 1 - (1 - p) ** 3;
        const endX = point.x + (40 + point.rand * 90) * 0.8;
        const endY = point.y - (20 + point.rand * 50) * 0.8;
        x = endX + (point.x - endX) * ease;
        y = endY + (point.y - endY) * ease;
        alpha = p;
        size = 5 * (0.3 + 0.7 * p);
        vermillion = point.rand < 0.06;
      }
    }

    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = vermillion ? '#C8432A' : '#1E1B17';
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawEmber(ctx, points, t) {
  ctx.fillStyle = '#1E1B17';
  if (t < 0.45 || t > 3.35) {
    ctx.globalAlpha = Math.min(1, (t - 3.35) / 0.6);
    person(ctx);
    ctx.globalAlpha = 1;
    return;
  }

  for (const point of points) {
    const start = 0.45 + point.nx * 0.5 + point.rand * 0.25;
    const p = (t - start) / 1.5;
    if (p <= 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1E1B17';
      ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5);
      continue;
    }
    if (p >= 1) continue;

    const x = point.x + Math.sin(t * 8 + point.phase) * 9 * p;
    const y = point.y - (30 + point.rand * 100) * p;
    const alpha = 1 - p;
    const size = 5 * (1 - 0.6 * p);
    ctx.globalAlpha = Math.max(0, alpha * 0.95);
    ctx.fillStyle = point.rand < 0.22 ? '#1E1B17' : '#C8432A';
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawGlitch(ctx, t) {
  const solid = t < 0.5 || t > 3.1;
  ctx.fillStyle = '#1E1B17';
  if (solid) {
    person(ctx);
    return;
  }

  const intensity = t < 2.4 ? Math.min(1, (t - 0.5) / 1.2) : 0;
  const phase = Math.floor(t * 9);

  if (intensity > 0) {
    for (let y = 0; y < H; y += 8) {
      const hash = fract(Math.sin(y * 12.9898 + phase * 78.233) * 43758.5453);
      if (hash < 0.1) continue;
      const offset = (hash - 0.5) * 30 * intensity;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, W, 8);
      ctx.clip();
      ctx.translate(offset, 0);
      ctx.fillStyle = Math.abs(offset) > 8 ? 'rgba(200,67,42,0.85)' : '#1E1B17';
      person(ctx);
      ctx.restore();
    }

    for (let line = 0; line < 2; line += 1) {
      const hash = fract(Math.sin((phase + line * 7) * 3.17) * 1234.567);
      ctx.fillStyle = 'rgba(200,67,42,0.75)';
      ctx.fillRect(0, 90 + hash * 150, W, 2);
    }
  } else {
    for (let line = 0; line < 3; line += 1) {
      const hash = fract(Math.sin((phase + line * 4) * 3.17) * 987.654);
      ctx.fillStyle = 'rgba(30,27,23,0.18)';
      ctx.fillRect(0, 120 + hash * 140, W, 2);
    }
  }
}

function drawPortal(ctx, t) {
  const p = Math.min(1, Math.max(0, (t - 0.45) / 1.7));
  const radius = 12 + p * 74;
  const alpha = 0.9 * (1 - Math.max(0, p - 0.85) / 0.15);

  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -t * 26;
  ctx.strokeStyle = `rgba(200,67,42,${Math.max(0, alpha)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(120, 140, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#1E1B17';
  if (t < 0.45) {
    person(ctx);
    return;
  }
  if (t < 2.4) {
    const scale = 1 - p * 0.94;
    ctx.save();
    ctx.globalAlpha = 1 - p * 0.92;
    ctx.translate(120, 140);
    ctx.scale(scale, scale);
    ctx.translate(-120, -140);
    person(ctx);
    ctx.restore();
    return;
  }
  if (t > 3.15) {
    ctx.globalAlpha = Math.min(1, (t - 3.15) / 0.7);
    person(ctx);
    ctx.globalAlpha = 1;
  }
}

function drawFade(ctx, t) {
  let alpha = 1;
  if (t < 0.6) alpha = 1;
  else if (t < 2.4) alpha = 1 - (t - 0.6) / 1.8;
  else if (t < 3.2) alpha = 0;
  else alpha = Math.min(1, (t - 3.2) / 0.8);

  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = '#1E1B17';
  person(ctx);
  ctx.globalAlpha = 1;
}

function fract(value) {
  return value - Math.floor(value);
}
