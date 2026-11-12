import { useEffect, useRef } from 'react';

interface SparklineProps {
  samples: number[]; // 0-100
  height?: number;
}

/** Live CPU history — phosphor area trace on a hairline grid. */
export function Sparkline({ samples, height = 72 }: SparklineProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(13, 12, 34, 0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const data = samples.length >= 2 ? samples : [0, 0];
    const maxN = 48;
    const slice = data.slice(-maxN);
    const x = (i: number) => (i / (maxN - 1)) * w;
    const y = (v: number) => h - (Math.min(100, Math.max(0, v)) / 100) * (h - 6) - 3;

    // fill
    ctx.beginPath();
    ctx.moveTo(x(0), h);
    slice.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(slice.length - 1), h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(81, 81, 212, 0.14)');
    grad.addColorStop(1, 'rgba(81, 81, 212, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    slice.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.strokeStyle = '#5151d4';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // head dot
    const last = slice[slice.length - 1];
    ctx.beginPath();
    ctx.arc(x(slice.length - 1), y(last), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#5151d4';
    ctx.fill();
  }, [samples, height]);

  return <canvas ref={ref} className="w-full" style={{ height }} aria-hidden="true" />;
}
