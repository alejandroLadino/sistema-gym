"use client";

import { useState } from "react";
import { formatDate, formatKg, formatShortDate } from "@/lib/format";

export type ChartPoint = { date: string; value: number; label: string };

const W = 400;
const H = 240;
const PAD = { top: 28, right: 14, bottom: 30, left: 40 };

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    const d = Math.max(1, Math.abs(min) * 0.1);
    min -= d;
    max += d;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

/** Una serie: valor máximo por sesión. Tooltip al tocar o pasar el cursor. */
export function ProgressChart({ points, unit, title }: { points: ChartPoint[]; unit: "kg" | "reps"; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const { lo, hi, ticks } = niceTicks(Math.min(...values, unit === "reps" ? 0 : Infinity), Math.max(...values));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const fmt = (v: number) => (unit === "kg" ? `${formatKg(v)} kg` : `${v} reps`);

  // Etiquetas del eje X: como máximo ~6 para que no se encimen.
  const every = Math.max(1, Math.ceil(points.length / 6));
  const last = points.length - 1;
  const bestIndex = values.indexOf(Math.max(...values));
  const shown = active ?? null;

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="label" style={{ marginBottom: 6 }}>{title}</figcaption>
      <div style={{ position: "relative" }}>
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}. ${points.length} sesiones. Máximo ${fmt(Math.max(...values))}.`}
          onPointerLeave={() => setActive(null)}
        >
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} strokeWidth={1} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((t) => (
              <text key={t} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{unit === "kg" ? formatKg(t) : t}</text>
            ))}
            {points.map((p, i) =>
              i % every === 0 || i === last ? (
                <text key={p.date + i} x={x(i)} y={H - 10} textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"}>
                  {formatShortDate(p.date)}
                </text>
              ) : null,
            )}
          </g>
          {shown !== null ? (
            <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted)" strokeDasharray="3 3" />
          ) : null}
          <path className="line" d={path} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={i} className="point" cx={x(i)} cy={y(p.value)} r={shown === i ? 6 : 4.5} />
          ))}
          {/* Etiqueta directa solo en el último y en el mejor valor */}
          {[...new Set([bestIndex, last])].map((i) => (
            <text key={`v${i}`} className="value" x={x(i)} y={y(points[i].value) - 10} textAnchor={i === last && points.length > 1 ? "end" : "middle"}>
              {fmt(points[i].value)}
            </text>
          ))}
          {/* Zonas táctiles más grandes que el punto */}
          {points.map((p, i) => {
            const half = points.length === 1 ? innerW / 2 : innerW / (points.length - 1) / 2;
            return (
              <rect
                key={`hit${i}`}
                x={x(i) - half}
                y={PAD.top}
                width={half * 2}
                height={innerH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
            );
          })}
        </svg>
        {shown !== null ? (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 0,
              left: `${(x(shown) / W) * 100}%`,
              transform: `translateX(${shown === 0 ? "0" : shown === last ? "-100%" : "-50%"})`,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "6px 10px",
              fontSize: 13,
              pointerEvents: "none",
              boxShadow: "var(--shadow)",
              whiteSpace: "nowrap",
            }}
          >
            <strong>{fmt(points[shown].value)}</strong>
            <div className="muted">{formatDate(points[shown].date)}</div>
            <div className="muted">{points[shown].label}</div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
