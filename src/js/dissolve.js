const LOOP = 10;
const DISSOLVE_START = 2.2;
const HIDDEN_END = 7.9;

const alphaBuckets = [0.16, 0.36, 0.6, 0.82, 1];

export function initHero() {
  const tile = document.querySelector('[data-hero]');
  if (!tile) return;
  const canvas = tile.querySelector('[data-dissolve]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ui = {
    label: tile.querySelector('[data-call-state]'),
    mic: tile.querySelector('[data-call-mic]'),
    toggle: tile.querySelector('[data-hero-toggle]'),
    replay: tile.querySelector('[data-hero-replay]'),
  };

  const state = {
    W: 0,
    H: 0,
    dpr: 1,
    room: null,
    parts: null,
    t: reduced ? 3.35 : 0,
    raf: 0,
    last: 0,
    running: false,
    paused: false,
    inView: true,
    reduced,
    uiKey: '',
    micMuted: null,
  };

  const shouldRun = () =>
    !state.reduced && !state.paused && state.inView && !document.hidden;

  function draw(t) {
    if (!state.room || !state.parts) return;
    const { W, H } = state;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(state.room, 0, 0, W, H);

    // A 1% flicker while the room is empty keeps it feeling like live video.
    if (t > 5 && t < 7.4) {
      const flicker = 0.006 + 0.005 * Math.sin(t * 9.5);
      ctx.fillStyle = `rgba(30,27,23,${flicker.toFixed(4)})`;
      ctx.fillRect(0, 0, W, H);
    }

    const idle = t < 2.2 || t >= 9.6;
    const breath = idle ? 1 + Math.sin(t * 1.7) * 0.003 : 1;

    ctx.save();
    ctx.translate(W / 2, H);
    ctx.scale(breath, breath);
    ctx.translate(-W / 2, -H);
    drawParticles(t);
    ctx.restore();

    drawCue(t);
    syncUi(t);
  }

  function drawParticles(t) {
    const parts = state.parts;
    if (!parts) return;
    const base = parts.step + 1;
    const ink = parts.inkBuckets;
    const ver = parts.verBuckets;
    for (let bucket = 0; bucket < 5; bucket += 1) {
      ink[bucket].length = 0;
      ver[bucket].length = 0;
    }

    for (let i = 0; i < parts.n; i += 1) {
      const homeX = parts.x[i];
      const homeY = parts.y[i];
      let x = homeX;
      let y = homeY;
      let size = base;
      let alpha = 1;
      let vermillion = false;

      if (t >= 2.2 && t < HIDDEN_END) {
        const start = DISSOLVE_START + parts.nx[i] * 0.9 + parts.delay[i];
        if (t >= start) {
          const p = Math.min(1, (t - start) / 1.05);
          if (p >= 1) continue;
          const d = p * 1.05;
          alpha = 1 - p;
          size = base * (1 - 0.72 * p);
          x = homeX + parts.vx[i] * d + Math.sin(t * 4 + parts.phase[i]) * 6 * p;
          y = homeY + parts.vy[i] * d + Math.cos(t * 3 + parts.phase[i]) * 3 * p;
          vermillion = parts.verm[i] === 1;
        }
      } else if (t >= HIDDEN_END && t < 9.6) {
        const start = HIDDEN_END + (1 - parts.nx[i]) * 0.55 + parts.delay[i];
        const p = (t - start) / 0.95;
        if (p <= 0) continue;
        if (p < 1) {
          const ease = 1 - (1 - p) ** 3;
          const endX = homeX + parts.vx[i] * 1.05 + Math.sin(parts.phase[i]) * 10;
          const endY = homeY + parts.vy[i] * 1.05 + Math.cos(parts.phase[i]) * 6;
          x = endX + (homeX - endX) * ease;
          y = endY + (homeY - endY) * ease;
          alpha = p;
          size = base * (0.3 + 0.7 * p);
          vermillion = parts.verm[i] === 1;
        }
      }

      if (alpha < 0.08) continue;

      const bucket = Math.max(0, Math.min(4, Math.round(alpha * 4)));
      parts.drawX[i] = x;
      parts.drawY[i] = y;
      parts.drawS[i] = size;
      (vermillion ? ver : ink)[bucket].push(i);
    }

    const fills = [
      { buckets: ink, rgb: '30,27,23' },
      { buckets: ver, rgb: '200,67,42' },
    ];

    for (const fill of fills) {
      for (let bucket = 0; bucket < 5; bucket += 1) {
        const list = fill.buckets[bucket];
        if (!list.length) continue;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 1) {
          const i = list[k];
          const size = parts.drawS[i];
          ctx.rect(parts.drawX[i] - size / 2, parts.drawY[i] - size / 2, size, size);
        }
        ctx.fillStyle = `rgba(${fill.rgb},${alphaBuckets[bucket]})`;
        ctx.fill();
      }
    }
  }

  function drawCue(t) {
    const { W, H } = state;
    let local = -1;
    if (t >= 1.6 && t < 2.25) local = t - 1.6;
    else if (t >= 7.4 && t < 7.95) local = t - 7.4;
    if (local < 0) return;

    const first = t < 5;
    const hx = W * 0.665;
    const hy = H * 0.58;
    const pulse = Math.min(1, local / 0.62);
    const radius = 4 + pulse * Math.min(W, H) * 0.13;

    ctx.beginPath();
    ctx.arc(hx + 8, hy - 10, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(200,67,42,${(1 - pulse) * 0.8})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    if (first && local < 0.5) {
      const fadeIn = Math.min(1, local / 0.08);
      const fadeOut = Math.max(0, 1 - Math.max(0, local - 0.4) / 0.1);
      const alpha = fadeIn * fadeOut;
      if (alpha > 0) {
        const scale = Math.max(0.8, W / 760);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(hx, hy);
        ctx.rotate(-0.12 + Math.sin(local * 24) * 0.16);
        ctx.scale(scale, scale);
        ctx.fillStyle = 'rgba(30,27,23,0.9)';
        ctx.beginPath();
        ctx.roundRect(-5, -2, 10, 13, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,27,23,0.9)';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-4, 3);
        ctx.lineTo(-9, -3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(3, -2);
        ctx.lineTo(6, -11);
        ctx.lineTo(9.5, -9.5);
        ctx.stroke();
        ctx.restore();
      }
    }

    let caption = 0;
    if (first && t >= 1.88 && t < 2.26) {
      caption = Math.min(1, (t - 1.88) / 0.08) * Math.max(0, 1 - Math.max(0, t - 2.08) / 0.18);
    } else if (!first && t >= 7.55 && t < 7.95) {
      caption = Math.min(1, (t - 7.55) / 0.06) * Math.max(0, 1 - Math.max(0, t - 7.68) / 0.2);
    }
    if (caption > 0) {
      ctx.font = `500 ${Math.max(9, Math.round(W * 0.0125))}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = `rgba(30,27,23,${0.55 * caption})`;
      ctx.fillText('*snap*', hx - 4, hy - Math.max(28, H * 0.08));
    }
  }

  function syncUi(t) {
    const hidden = t >= 2.2 && t < HIDDEN_END;
    const seconds = hidden ? Math.floor(t - DISSOLVE_START) : 0;
    const key = `${hidden ? 1 : 0}:${seconds}`;

    if (key !== state.uiKey) {
      state.uiKey = key;
      tile.classList.toggle('is-hidden', hidden);
      if (ui.label) {
        ui.label.textContent = hidden
          ? `Hidden · ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
          : 'On camera';
      }
    }

    const muted = t >= 2.4 && t < HIDDEN_END;
    if (muted !== state.micMuted) {
      state.micMuted = muted;
      ui.mic?.classList.toggle('is-muted', muted);
    }
  }

  function frame(now) {
    if (!state.running) return;
    if (!state.last) state.last = now;
    const dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    state.t = (state.t + dt) % LOOP;
    draw(state.t);
    state.raf = window.requestAnimationFrame(frame);
  }

  function start() {
    if (state.running || !shouldRun()) return;
    state.running = true;
    state.last = 0;
    state.raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    state.running = false;
    window.cancelAnimationFrame(state.raf);
  }

  function syncRun() {
    if (shouldRun()) start();
    else stop();
  }

  function buildParticles(W, H) {
    const step = W < 420 ? 2 : 3;
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = '#000';
    pathPerson(maskCtx, W, H);
    const data = maskCtx.getImageData(0, 0, W, H).data;

    const xs = [];
    const ys = [];
    const nx = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (data[(y * W + x) * 4 + 3] > 128) {
          xs.push(x + 0.5);
          ys.push(y + 0.5);
          nx.push(x / W);
        }
      }
    }

    const n = xs.length;
    const parts = {
      n,
      step,
      x: Float32Array.from(xs),
      y: Float32Array.from(ys),
      nx: Float32Array.from(nx),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      phase: new Float32Array(n),
      delay: new Float32Array(n),
      verm: new Uint8Array(n),
      drawX: new Float32Array(n),
      drawY: new Float32Array(n),
      drawS: new Float32Array(n),
      inkBuckets: [[], [], [], [], []],
      verBuckets: [[], [], [], [], []],
    };

    const scale = W / 768;
    for (let i = 0; i < n; i += 1) {
      parts.vx[i] = (40 + Math.random() * 120) * scale;
      parts.vy[i] = -(20 + Math.random() * 60) * scale;
      parts.phase[i] = Math.random() * Math.PI * 2;
      parts.delay[i] = Math.random() * 0.2;
      parts.verm[i] = Math.random() < 0.06 ? 1 : 0;
    }

    return parts;
  }

  function pathPerson(g, W, H) {
    const cx = W * 0.5;
    const headR = H * 0.125;
    const headY = H * 0.435;
    g.beginPath();
    g.arc(cx, headY, headR, 0, Math.PI * 2);
    g.rect(cx - headR * 0.4, headY + headR * 0.55, headR * 0.8, headR * 0.85);
    g.moveTo(cx - W * 0.265, H);
    g.bezierCurveTo(cx - W * 0.252, H * 0.77, cx - W * 0.13, H * 0.665, cx, H * 0.665);
    g.bezierCurveTo(cx + W * 0.13, H * 0.665, cx + W * 0.252, H * 0.77, cx + W * 0.265, H);
    g.closePath();
    g.fill();
  }

  function buildRoom(W, H, dpr) {
    const room = document.createElement('canvas');
    room.width = Math.round(W * dpr);
    room.height = Math.round(H * dpr);
    const g = room.getContext('2d');
    g.scale(dpr, dpr);

    g.fillStyle = '#D9D1C4';
    g.fillRect(0, 0, W, H);

    const light = g.createRadialGradient(W * 0.26, H * 0.06, 0, W * 0.26, H * 0.06, W * 0.78);
    light.addColorStop(0, 'rgba(245,242,236,0.3)');
    light.addColorStop(1, 'rgba(245,242,236,0)');
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);

    // Window, left.
    const wx = W * 0.055;
    const wy = H * 0.17;
    const ww = W * 0.255;
    const wh = H * 0.34;
    g.fillStyle = '#E8E2D6';
    g.fillRect(wx, wy, ww, wh);
    g.strokeStyle = 'rgba(30,27,23,0.12)';
    g.lineWidth = Math.max(1, W * 0.0024);
    g.strokeRect(wx, wy, ww, wh);
    g.beginPath();
    g.moveTo(wx + ww / 2, wy);
    g.lineTo(wx + ww / 2, wy + wh);
    g.moveTo(wx, wy + wh * 0.52);
    g.lineTo(wx + ww, wy + wh * 0.52);
    g.stroke();
    g.fillStyle = 'rgba(245,242,236,0.32)';
    g.fillRect(wx + ww * 0.06, wy, ww * 0.13, wh);

    // Shelf, right, with three books.
    const sx = W * 0.7;
    const sy = H * 0.365;
    const sw = W * 0.235;
    g.fillStyle = '#BFB4A3';
    g.fillRect(sx, sy, sw, Math.max(4, H * 0.014));
    const books = [
      { w: 0.026, h: 0.085, color: '#8C7F6E' },
      { w: 0.022, h: 0.105, color: '#A39682' },
      { w: 0.03, h: 0.072, color: '#6E6253' },
    ];
    let bx = sx + sw * 0.18;
    for (const book of books) {
      const bw = W * book.w;
      const bh = H * book.h;
      g.fillStyle = book.color;
      g.fillRect(bx, sy - bh, bw, bh);
      bx += bw + W * 0.008;
    }

    // Plant, bottom right.
    const px = W * 0.86;
    const py = H * 0.87;
    g.fillStyle = '#BFB4A3';
    g.beginPath();
    g.moveTo(px - W * 0.028, py);
    g.lineTo(px + W * 0.028, py);
    g.lineTo(px + W * 0.021, py + H * 0.055);
    g.lineTo(px - W * 0.021, py + H * 0.055);
    g.closePath();
    g.fill();
    g.fillStyle = '#7C8A6A';
    for (const leaf of [
      { x: -0.032, y: -0.07, rx: 0.026, ry: 0.052, r: -0.6 },
      { x: 0.014, y: -0.085, rx: 0.024, ry: 0.06, r: 0.35 },
      { x: -0.006, y: -0.045, rx: 0.03, ry: 0.04, r: 0 },
      { x: 0.036, y: -0.05, rx: 0.02, ry: 0.04, r: 0.9 },
    ]) {
      g.beginPath();
      g.ellipse(px + leaf.x * W, py + leaf.y * H, leaf.rx * W, leaf.ry * H, leaf.r, 0, Math.PI * 2);
      g.fill();
    }

    // Floor line and vignette.
    g.fillStyle = 'rgba(30,27,23,0.07)';
    g.fillRect(0, H * 0.9, W, H * 0.1);
    const vignette = g.createRadialGradient(W * 0.5, H * 0.46, W * 0.12, W * 0.5, H * 0.5, W * 0.74);
    vignette.addColorStop(0, 'rgba(30,27,23,0)');
    vignette.addColorStop(1, 'rgba(30,27,23,0.2)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, W, H);

    return room;
  }

  let resizeTimer = 0;
  function resize() {
    const rect = tile.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    if (W === state.W && H === state.H && dpr === state.dpr) return;

    state.W = W;
    state.H = H;
    state.dpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.room = buildRoom(W, H, dpr);
    state.parts = buildParticles(W, H);
    draw(state.t);
  }

  function updateToggle() {
    if (!ui.toggle) return;
    ui.toggle.setAttribute('aria-pressed', String(state.paused));
    ui.toggle.setAttribute('aria-label', state.paused ? 'Play the snap animation' : 'Pause the snap animation');
  }

  ui.toggle?.addEventListener('click', () => {
    if (state.reduced) return;
    state.paused = !state.paused;
    updateToggle();
    if (state.paused) {
      stop();
      draw(state.t);
    } else {
      start();
    }
  });

  ui.replay?.addEventListener('click', () => {
    if (state.reduced) {
      draw(3.35);
      return;
    }
    state.t = 1.55;
    state.paused = false;
    updateToggle();
    draw(state.t);
    start();
  });

  new IntersectionObserver(
    ([entry]) => {
      state.inView = entry.isIntersecting;
      syncRun();
    },
    { threshold: 0.05 },
  ).observe(tile);

  document.addEventListener('visibilitychange', syncRun);

  const observer = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 180);
  });
  observer.observe(tile);

  resize();

  if (state.reduced) {
    state.t = 3.35;
    draw(state.t);
    if (ui.toggle) {
      ui.toggle.disabled = true;
      ui.toggle.setAttribute('aria-label', 'Animation paused for reduced motion');
    }
    if (ui.replay) ui.replay.disabled = true;
    return;
  }

  draw(0);
  start();
}
