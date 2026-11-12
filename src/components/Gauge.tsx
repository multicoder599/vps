import { loadColor } from '@/lib/format';

interface GaugeProps {
  value: number; // 0-100
  label: string;
  sub?: string;
  size?: number;
}

/** Radial utilization gauge — hairline track, glowing progress arc. */
export function Gauge({ value, label, sub, size = 116 }: GaugeProps) {
  const stroke = 6;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, value));
  const offset = c - (p / 100) * c;
  const color = loadColor(p);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="#262626" strokeWidth={stroke}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease', filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-semibold tabular-nums" style={{ color }}>
            {Math.round(p)}
            <span className="text-xs text-muted-foreground">%</span>
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="label-tech">{label}</div>
        {sub && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
