/**
 * Fondo animado de circuitos: pistas de placa con pulsos de luz RGB.
 * Se pausa con la pestaña oculta y respeta "reducir movimiento".
 */
import { useEffect, useRef } from "react";

const COLORS = ["#00f2fe", "#9d4edd", "#f72585", "#e8823c"];
const GRID = 46;

function buildTraces(width, height) {
  const cols = Math.ceil(width / GRID) + 1;
  const rows = Math.ceil(height / GRID) + 1;
  const count = Math.min(70, Math.round((cols * rows) / 9));
  const traces = [];
  for (let i = 0; i < count; i++) {
    let x = Math.floor(Math.random() * cols);
    let y = Math.floor(Math.random() * rows);
    const points = [[x * GRID, y * GRID]];
    let dir = Math.floor(Math.random() * 4);
    const steps = 3 + Math.floor(Math.random() * 6);
    for (let s = 0; s < steps; s++) {
      if (Math.random() < 0.35) dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      const len = 1 + Math.floor(Math.random() * 3);
      x += [1, 0, -1, 0][dir] * len;
      y += [0, 1, 0, -1][dir] * len;
      points.push([x * GRID, y * GRID]);
    }
    let length = 0;
    for (let p = 1; p < points.length; p++) length += Math.abs(points[p][0] - points[p - 1][0]) + Math.abs(points[p][1] - points[p - 1][1]);
    traces.push({ points, length, color: COLORS[i % COLORS.length], offset: Math.random(), speed: 0.04 + Math.random() * 0.08 });
  }
  return traces;
}

function pointAt(points, distance) {
  let left = distance;
  for (let p = 1; p < points.length; p++) {
    const [x0, y0] = points[p - 1];
    const [x1, y1] = points[p];
    const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (left <= seg) {
      const t = seg ? left / seg : 0;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    left -= seg;
  }
  return points[points.length - 1];
}

export function CircuitBackground({ intensity = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let traces = [];
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      traces = buildTraces(width, height);
    };

    const draw = (time) => {
      ctx.clearRect(0, 0, width, height);
      for (const tr of traces) {
        ctx.strokeStyle = "rgba(255,255,255,0.045)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        tr.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        const [ex, ey] = tr.points[tr.points.length - 1];
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(ex - 2.5, ey - 2.5, 5, 5);

        if (!reduced) {
          const progress = ((time / 1000) * tr.speed + tr.offset) % 1;
          const [px, py] = pointAt(tr.points, progress * tr.length);
          const glow = ctx.createRadialGradient(px, py, 0, px, py, 14);
          glow.addColorStop(0, tr.color);
          glow.addColorStop(1, "transparent");
          ctx.globalAlpha = 0.55 * intensity;
          ctx.fillStyle = glow;
          ctx.fillRect(px - 14, py - 14, 28, 28);
          ctx.globalAlpha = 1;
        }
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    resize();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intensity]);

  return (
    <div className="circuit-bg" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
