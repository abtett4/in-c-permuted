// The p5.js sketch: a scrolling piano roll of every note scsynth is playing.
// Time runs right to left past the "now" line; height is pitch; color is the
// SynthDef. Notes appear just before they sound (they're scheduled ahead),
// ripple when they hit, and fade as they scroll away.

const HISTORY = 7;       // seconds visible to the left of "now"
const HEIGHT = 260;

export function startViz(container, getFrame, pitchRange) {
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(name).trim();
  const BG = color('--viz-bg');
  const GRID = color('--viz-grid');
  const TEXT = color('--text-dim');
  const NOW = color('--accent');

  const lo = pitchRange[0] - 3;
  const hi = pitchRange[1] + 3;

  return new window.p5(p => {
    let W = container.clientWidth;
    const ripples = [];

    p.setup = () => {
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      p.createCanvas(W, HEIGHT).parent(container);
      p.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    };

    p.windowResized = () => {
      W = container.clientWidth;
      p.resizeCanvas(W, HEIGHT);
    };

    const yOf = n => p.map(n, lo, hi, HEIGHT - 18, 18);

    p.draw = () => {
      const f = getFrame();
      const nowX = Math.round(W * 0.84);
      const pps = nowX / HISTORY;
      const xOf = t => nowX + (t - f.now) * pps;

      p.background(BG);

      // Octave guides on every C.
      p.textSize(10);
      p.textAlign(p.LEFT, p.CENTER);
      for (let n = Math.ceil(lo / 12) * 12; n <= hi; n += 12) {
        const y = yOf(n);
        p.stroke(GRID);
        p.strokeWeight(1);
        p.line(0, y, W, y);
        p.noStroke();
        p.fill(TEXT);
        p.text(`C${n / 12 - 1}`, 8, y - 7);
      }

      // The pulse: a tick every quarter beat (an eighth note at 1/4 dur).
      if (f.playing) {
        const b0 = f.beat - HISTORY * f.tempo;
        const b1 = f.beat + ((W - nowX) / pps) * f.tempo;
        for (let b = Math.ceil(b0 * 4) / 4; b <= b1; b += 0.25) {
          const x = xOf(f.now + (b - f.beat) / f.tempo);
          const whole = Math.abs(b - Math.round(b)) < 1e-6;
          p.stroke(GRID);
          p.strokeWeight(whole ? 1.5 : 0.75);
          p.line(x, whole ? 0 : HEIGHT - 10, x, HEIGHT);
        }
      }

      // Notes.
      const drawingContext = p.drawingContext;
      let sounding = new Set();
      for (const n of f.notes) {
        const x0 = xOf(n.time);
        const x1 = Math.max(x0 + 3, xOf(n.end));
        if (x1 < 0 || x0 > W) continue;
        const y = yOf(n.midinote);
        const c = p.color(f.colorFor(n.instrument));
        const live = f.now >= n.time && f.now <= n.end;
        const quiet = f.gains[n.module] === 0;
        if (live) sounding.add(n.module);

        if (!n.fired && f.now >= n.time) {
          n.fired = true;
          if (!quiet) ripples.push({ y, c, born: p.millis() });
        }

        if (n.time > f.now) {
          // Scheduled, not sounding yet.
          c.setAlpha(quiet ? 40 : 150);
          p.noFill();
          p.stroke(c);
          p.strokeWeight(1);
          p.rect(x0, y - 3, x1 - x0, 6, 3);
          continue;
        }
        const age = Math.max(0, f.now - n.end);
        c.setAlpha(quiet ? 30 : live ? 255 : p.map(age, 0, HISTORY, 190, 30, true));
        p.noStroke();
        p.fill(c);
        if (live && !quiet) {
          drawingContext.shadowBlur = 14;
          drawingContext.shadowColor = f.colorFor(n.instrument);
        }
        p.rect(x0, y - 3, x1 - x0, 6, 3);
        drawingContext.shadowBlur = 0;
      }

      // Ripples where notes strike the "now" line.
      const t = p.millis();
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const k = (t - r.born) / 700;
        if (k >= 1) { ripples.splice(i, 1); continue; }
        r.c.setAlpha(200 * (1 - k));
        p.noFill();
        p.stroke(r.c);
        p.strokeWeight(1.5);
        p.circle(nowX, r.y, 6 + k * 34);
      }

      // "Now".
      p.stroke(NOW);
      p.strokeWeight(1.5);
      p.line(nowX, 0, nowX, HEIGHT);

      // Legend and readout.
      p.noStroke();
      p.textAlign(p.LEFT, p.TOP);
      p.textSize(11);
      let lx = 44;
      for (const name of f.instruments) {
        p.fill(f.colorFor(name));
        p.rect(lx, 11, 10, 10, 2);
        p.fill(TEXT);
        p.text(name, lx + 15, 10);
        lx += p.textWidth(name) + 34;
      }
      p.textAlign(p.RIGHT, p.TOP);
      p.fill(TEXT);
      if (f.playing) p.text(`${sounding.size} module${sounding.size === 1 ? '' : 's'} sounding`, nowX - 8, 10);

      if (!f.playing && !f.notes.length) {
        // Idle: the pulse on C, breathing.
        const n = 24;
        for (let i = 0; i < n; i++) {
          const x = ((i + 0.5) / n) * W;
          const a = 60 + 50 * Math.sin(t / 420 - i * 0.5);
          p.fill(p.red(p.color(NOW)), p.green(p.color(NOW)), p.blue(p.color(NOW)), a);
          p.circle(x, yOf(72), 4);
          p.circle(x, yOf(60), 4);
        }
        p.fill(TEXT);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(13);
        p.text('Press Play. The piece runs on SuperCollider (scsynth) inside this browser tab.', W / 2, HEIGHT / 2);
      }
    };
  });
}
