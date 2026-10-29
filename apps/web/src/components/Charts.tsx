import { useRef, useState } from "react";

// Single-series charts in Zifra's black and white: ink marks with 4px rounded
// data ends, recessive grid, a tooltip on hover or tap, and the numbers always
// available as text next to or under the chart.

export interface Datum {
  key: string;
  label: string;
  value: number;
  /** Extra line in the tooltip, e.g. "12 entries · 34%". */
  detail?: string;
  /** Mark colour when the group itself has meaning (statuses). */
  color?: string | null;
}

function Tooltip({ x, y, title, value, detail, align = "center" }: { x: number; y: number; title: string; value: string; detail?: string; align?: "center" | "left" }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg bg-ink px-3 py-2 text-sm whitespace-nowrap text-paper shadow-xl"
      style={{ left: x, top: y, transform: align === "center" ? "translate(-50%, calc(-100% - 10px))" : "translate(12px, -50%)" }}
    >
      <div className="font-semibold opacity-80">{title}</div>
      <div className="text-base font-extrabold">{value}</div>
      {detail && <div className="opacity-80">{detail}</div>}
    </div>
  );
}

/** Horizontal bars for categories, largest first, value printed at the end of each bar. */
export function BarList({ data, fmt }: { data: Datum[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <ul className="space-y-1">
      {data.map((d) => (
        <li key={d.key} className="group grid grid-cols-[minmax(6rem,30%)_1fr] items-center gap-4 rounded-lg py-1.5 hover:bg-soft" title={d.detail}>
          <span className="truncate pl-1 font-semibold">{d.label}</span>
          <span className="flex items-center gap-3">
            <span className="h-6 min-w-[3px] rounded-r-[4px]" style={{ width: `${(Math.abs(d.value) / max) * 82}%`, background: d.color ?? "var(--ink)" }} />
            <span className="shrink-0 font-extrabold">{fmt(d.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Vertical columns or a line over ordered keys (months). */
export function TimeChart({ data, fmt, kind }: { data: Datum[]; fmt: (n: number) => string; kind: "columns" | "line" }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 260;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const step = innerW / Math.max(1, data.length);
  const x = (i: number) => pad.l + step * i + step / 2;
  const y = (v: number) => pad.t + innerH - (Math.max(0, v) / top) * innerH;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => top * f);
  const labelEvery = Math.ceil(data.length / 12);

  const onMove = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(data.length - 1, Math.floor((px - pad.l) / step))));
  };

  const hovered = hover !== null ? data[hover] : null;
  return (
    <div ref={box} className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={data.map((d) => `${d.label}: ${fmt(d.value)}`).join(", ")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={W - pad.r} y={y(v) - 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">
              {fmt(v)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--rule)" strokeWidth={2} />
        {kind === "columns" &&
          data.map((d, i) => {
            const w = Math.max(3, Math.min(48, step - 6));
            const h = Math.max(0, y(0) - y(d.value));
            const r = Math.min(4, h / 2, w / 2);
            const x0 = x(i) - w / 2;
            const y0 = y(d.value);
            return (
              <path
                key={d.key}
                d={`M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + w - r} Q${x0 + w},${y0} ${x0 + w},${y0 + r} V${y(0)} Z`}
                fill={hover === null || hover === i ? (d.color ?? "var(--ink)") : "var(--ink-2)"}
                opacity={hover === null || hover === i ? 1 : 0.35}
              />
            );
          })}
        {kind === "line" && data.length > 0 && (
          <>
            <polyline points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="var(--ink-2)" strokeDasharray="3 3" />
                <circle cx={x(hover)} cy={y(data[hover].value)} r={5} fill="var(--ink)" stroke="var(--paper)" strokeWidth={2} />
              </>
            )}
          </>
        )}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {hovered && hover !== null && (
        <Tooltip
          x={(x(hover) / W) * (box.current?.clientWidth ?? W)}
          y={(y(hovered.value) / H) * (box.current?.clientHeight ?? H)}
          title={hovered.label}
          value={fmt(hovered.value)}
          detail={hovered.detail}
        />
      )}
    </div>
  );
}
