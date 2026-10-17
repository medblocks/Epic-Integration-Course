// A line chart drawn with plain SVG. No chart library: the spec allows only
// react, react-dom, vite and typescript. Section 7, "Graph".
//
// - One y axis. Blood pressure plots two series on the same mmHg scale.
// - 2px lines with round joins, markers with a 2px ring in the surface colour,
//   solid hairline gridlines.
// - Text uses text colours. Only lines and markers carry the series colour.
// - Hover and keyboard focus show the same readout, mirrored in an aria-live
//   region. Every value is also in the table, so the tooltip never holds
//   information that is missing elsewhere.
// - Sized to the real pixel width of its container with a ResizeObserver.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber } from "../mapping";

export interface ChartPoint {
  key: string;
  time: number;
  dateText: string;
  values: (number | null)[];
}

export interface ChartSeries {
  name: string;
  // A CSS colour, normally a custom property such as "var(--series-1)".
  color: string;
}

const HEIGHT = 240;
const MARGIN = { top: 16, right: 56, bottom: 30, left: 44 };
const MAX_POINTS_WITH_MARKERS = 30;
const DAY = 24 * 60 * 60 * 1000;

// Rounds a raw step to 1, 2 or 5 times a power of ten so ticks are clean numbers.
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

// About four steps. The axis is not forced to start at zero.
function yTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / 4);
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0; low + i * step <= high + step / 2; i++) {
    ticks.push(Number((low + i * step).toPrecision(12)));
  }
  return ticks;
}

// Label by span: year only over 2 years, month and year over 60 days,
// month and day otherwise.
function xTickLabel(time: number, span: number): string {
  const date = new Date(time);
  if (span > 2 * 365 * DAY) return String(date.getFullYear());
  if (span > 60 * DAY) {
    return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function LineChart({
  title,
  unit,
  series,
  points,
}: {
  title: string;
  unit: string;
  series: ChartSeries[];
  // Oldest first. At least two.
  points: ChartPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  // Draw at the real pixel width so text never scales with the chart.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(260, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  let minTime = points[0].time;
  let maxTime = points[points.length - 1].time;
  if (minTime === maxTime) {
    minTime -= DAY;
    maxTime += DAY;
  }
  const span = maxTime - minTime;

  const allValues = points.flatMap((p) => p.values.filter((v): v is number => v !== null));
  const ticks = yTicks(Math.min(...allValues), Math.max(...allValues));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const x = (time: number) => MARGIN.left + ((time - minTime) / span) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

  // X ticks: evenly spaced in time, between 2 and 6 depending on width, and
  // a label is never repeated.
  const xTickCount = Math.min(6, Math.max(2, Math.floor(plotWidth / 110)));
  const xTicks: { time: number; label: string }[] = [];
  for (let i = 0; i < xTickCount; i++) {
    const time = minTime + (span * i) / (xTickCount - 1);
    const label = xTickLabel(time, span);
    if (!xTicks.some((t) => t.label === label)) xTicks.push({ time, label });
  }

  // One path per series. A missing value breaks the line instead of bridging it.
  const paths = series.map((_, s) => {
    let d = "";
    let penDown = false;
    for (const point of points) {
      const value = point.values[s];
      if (value === null) {
        penDown = false;
        continue;
      }
      d += `${penDown ? "L" : "M"}${x(point.time).toFixed(1)} ${y(value).toFixed(1)} `;
      penDown = true;
    }
    return d.trim();
  });

  // Direct label at the right end of each line. Dropped when two labels would
  // be less than 14px apart.
  const endLabels = series
    .map((_, s) => {
      for (let i = points.length - 1; i >= 0; i--) {
        const value = points[i].values[s];
        if (value !== null)
          return { s, x: x(points[i].time), y: y(value), text: formatNumber(value) };
      }
      return null;
    })
    .filter((label): label is { s: number; x: number; y: number; text: string } => label !== null);
  const labelsCollide = endLabels.some((a, i) =>
    endLabels.some((b, j) => j > i && Math.abs(a.y - b.y) < 14),
  );

  function nearestIndex(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    let best = 0;
    let bestDistance = Infinity;
    points.forEach((point, i) => {
      const distance = Math.abs(x(point.time) - px);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    setActive(nearestIndex(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const current = active ?? last;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(last, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const activePoint = active !== null ? points[active] : null;
  const activeX = activePoint ? x(activePoint.time) : 0;
  const tooltipOnLeft = activeX > width / 2;
  const showMarkers = points.length <= MAX_POINTS_WITH_MARKERS;

  return (
    <div className="chart-wrap">
      {series.length > 1 && (
        <ul className="chart-legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className="line-key" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <div
        ref={containerRef}
        className="chart"
        role="group"
        tabIndex={0}
        aria-label={`${title} graph${unit ? ` in ${unit}` : ""}, ${points.length} readings. Use the left and right arrow keys to read each value.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? points.length - 1)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === yMin ? "chart-axis" : "chart-grid"}
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="chart-tick"
                x={MARGIN.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {xTicks.map((tick, i) => (
            <text
              key={tick.time}
              className="chart-tick"
              x={x(tick.time)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            >
              {tick.label}
            </text>
          ))}

          {activePoint && (
            <line
              className="chart-crosshair"
              x1={activeX}
              x2={activeX}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
            />
          )}

          {paths.map((d, s) => (
            <path
              key={series[s].name}
              className="chart-line"
              d={d}
              style={{ stroke: series[s].color }}
            />
          ))}

          {showMarkers &&
            series.map((seriesItem, s) =>
              points.map((point) => {
                const value = point.values[s];
                if (value === null) return null;
                return (
                  <circle
                    key={`${seriesItem.name}-${point.key}`}
                    className="chart-marker"
                    cx={x(point.time)}
                    cy={y(value)}
                    r={4}
                    style={{ fill: seriesItem.color }}
                  />
                );
              }),
            )}

          {activePoint &&
            series.map((seriesItem, s) => {
              const value = activePoint.values[s];
              if (value === null) return null;
              return (
                <circle
                  key={seriesItem.name}
                  className="chart-marker"
                  cx={activeX}
                  cy={y(value)}
                  r={5}
                  style={{ fill: seriesItem.color }}
                />
              );
            })}

          {!labelsCollide &&
            endLabels.map((label) => (
              <text
                key={series[label.s].name}
                className="chart-end-label"
                x={label.x + 10}
                y={label.y}
                dy="0.32em"
              >
                {label.text}
              </text>
            ))}

          {/* Hit area covers the whole plot, so the pointer only has to be nearest. */}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {activePoint && (
          <div
            className="chart-tooltip"
            style={{
              top: MARGIN.top,
              left: tooltipOnLeft ? undefined : activeX + 12,
              right: tooltipOnLeft ? width - activeX + 12 : undefined,
            }}
          >
            <div className="tooltip-date">{activePoint.dateText}</div>
            {series.map((seriesItem, s) => {
              const value = activePoint.values[s];
              return (
                <div key={seriesItem.name} className="tooltip-row">
                  <span
                    className="line-key"
                    style={{ background: seriesItem.color }}
                    aria-hidden="true"
                  />
                  <strong>
                    {value !== null
                      ? `${formatNumber(value)}${unit ? ` ${unit}` : ""}`
                      : "Not recorded"}
                  </strong>
                  {series.length > 1 && <span className="tooltip-name">{seriesItem.name}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* The same readout for screen readers as the tooltip shows. */}
        <div className="visually-hidden" aria-live="polite">
          {activePoint
            ? `${activePoint.dateText}: ${series
                .map((seriesItem, s) => {
                  const value = activePoint.values[s];
                  return `${seriesItem.name} ${value !== null ? `${formatNumber(value)} ${unit}` : "not recorded"}`;
                })
                .join(", ")}`
            : ""}
        </div>
      </div>
    </div>
  );
}
