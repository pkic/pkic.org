/**
 * Chart markup.
 *
 * These build SVG as strings rather than as components, because that is how
 * the analytics surfaces consume them and rewriting the callers is a separate
 * job. What changed when they moved into the design system is what they emit.
 *
 * THE ACCESSIBILITY PROBLEM THEY HAD. Every chart carried aria-hidden="true"
 * and put its numbers in <title> elements *inside* that hidden subtree. So a
 * screen reader was not given a degraded version of the data — it was given
 * nothing at all, on pages whose entire purpose is the data. Hiding the SVG is
 * still right: a bar chart read out node by node is noise. The fix is to say
 * the same thing twice, once for each kind of reader. Every chart now emits a
 * visually hidden data table beside its picture, with the same numbers and a
 * caption naming the chart, and every builder REQUIRES that caption — an
 * unnamed chart was the bug.
 *
 * THE COLOUR PROBLEM. Every grey, grid line and default series colour was a
 * Bootstrap hex. In dark mode the grid drew light grey on a dark ground and
 * the value labels were near-black on it. Colours are tokens now, resolved by
 * the browser through `var()` in the SVG presentation attributes, so a chart
 * follows the theme and the accent like everything else.
 */

import { escapeHtml as esc } from "../shared/ui";

import "./Chart.css";

/** Series colours default to the state scale, which is theme-aware. */
export const CHART_SERIES_TOKENS = ["var(--pk-ok)", "var(--pk-warn)", "var(--pk-info)", "var(--pk-accent)"] as const;

const GRID = "var(--pk-line)";
const AXIS_INK = "var(--pk-ink-muted)";
const VALUE_INK = "var(--pk-ink)";
const FAINT_INK = "var(--pk-ink-faint)";
const BAND = "var(--pk-surface-sunk)";
const NEUTRAL = "var(--pk-ink-muted)";

export interface ChartCaption {
  /**
   * Names the chart. Read by assistive technology and used as the data
   * table's caption. Required: a chart nobody can name is a chart nobody can
   * read.
   */
  caption: string;
}

/** What a chart says when it has nothing to say. */
function noData(): string {
  return `<p class="pk-muted">No data</p>`;
}

/**
 * The same numbers, as a table, hidden from sight but not from a reader.
 *
 * `pk-sr-only` and `pk-muted` are entry-stylesheet utilities, so this markup
 * is styled on every page whether or not the chart's own chunk has loaded.
 */
function dataTable(
  caption: string,
  categoryHeader: string,
  columns: string[],
  rows: Array<[string, string[]]>,
): string {
  const head = [`<th scope="col">${esc(categoryHeader)}</th>`, ...columns.map((c) => `<th scope="col">${esc(c)}</th>`)];
  const body = rows.map(
    ([label, values]) =>
      `<tr><th scope="row">${esc(label)}</th>${values.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`,
  );
  return (
    `<table class="pk-sr-only">` +
    `<caption>${esc(caption)}</caption>` +
    `<thead><tr>${head.join("")}</tr></thead>` +
    `<tbody>${body.join("")}</tbody>` +
    `</table>`
  );
}

function figure(caption: string, svg: string, table: string, legend = ""): string {
  return `<figure class="pk-chart" aria-label="${esc(caption)}">${svg}${legend}${table}</figure>`;
}

function legendSwatch(color: string, label: string, trailing = ""): string {
  return (
    `<span class="pk-chart__key">` +
    `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">` +
    `<rect width="10" height="10" rx="2" fill="${color}"/></svg>` +
    `${esc(label)}${trailing}</span>`
  );
}

export function fmtMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  });
}

/**
 * A labelled progress bar per status. These use a real <progress>, so unlike
 * the SVG charts they were already readable; they keep their own semantics
 * and gain only the tokens.
 */
export function statusBars(byStatus: Record<string, number>, total: number): string {
  if (!total) return noData();
  return (
    `<div class="pk-chart__bars">` +
    Object.entries(byStatus)
      .map(([key, value]) => {
        const pct = Math.round((value / total) * 100);
        return (
          `<div class="pk-chart__bar-row"><span class="pk-chart__bar-label">${esc(key)}</span>` +
          `<progress class="pk-chart__bar" max="${total}" value="${value}" aria-label="${esc(key)}: ${pct}%">${pct}%</progress>` +
          `<span class="pk-chart__bar-count">${value}</span></div>`
        );
      })
      .join("") +
    `</div>`
  );
}

const STATUS_ORDER = ["registered", "pending_email_confirmation", "cancelled"];
const STATUS_COLORS: Record<string, string> = {
  registered: "var(--pk-ok)",
  pending_email_confirmation: "var(--pk-warn)",
  cancelled: "var(--pk-danger)",
};
const STATUS_LABELS: Record<string, string> = {
  registered: "Confirmed",
  pending_email_confirmation: "Pending",
  cancelled: "Cancelled",
};

export function svgStatusSegmentBar(byStatus: Record<string, number>, total: number, opts: ChartCaption): string {
  if (!total) return noData();
  const W = 460;
  const barH = 20;
  const radius = 4;
  const sorted = [...STATUS_ORDER, ...Object.keys(byStatus).filter((key) => !STATUS_ORDER.includes(key))];
  const items = sorted.map((key) => [key, byStatus[key] ?? 0] as [string, number]).filter(([, value]) => value > 0);

  let x = 0;
  let segments = "";
  items.forEach(([key, value], index) => {
    const segW = (value / total) * W;
    const color = STATUS_COLORS[key] ?? NEUTRAL;
    const label = STATUS_LABELS[key] ?? key;
    const pct = Math.round((value / total) * 100);
    const isFirst = index === 0;
    const isLast = index === items.length - 1;
    const title = `<title>${esc(`${label}: ${value} (${pct}%)`)}</title>`;
    segments += `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="${barH}" fill="${color}"${isFirst || isLast ? ` rx="${radius}"` : ""}>${title}</rect>`;
    // Square off the inner corner so adjacent segments meet flush.
    if (isFirst && !isLast) {
      segments += `<rect x="${(x + segW - radius).toFixed(2)}" y="0" width="${radius}" height="${barH}" fill="${color}"/>`;
    } else if (isLast && !isFirst) {
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${radius}" height="${barH}" fill="${color}"/>`;
    }
    x += segW;
  });

  const legend = items
    .map(([key, value]) => {
      const pct = Math.round((value / total) * 100);
      return legendSwatch(
        STATUS_COLORS[key] ?? NEUTRAL,
        `${STATUS_LABELS[key] ?? key}: `,
        `<strong>${value}</strong> <span class="pk-muted">(${pct}%)</span>`,
      );
    })
    .join("");

  const table = dataTable(
    opts.caption,
    "Status",
    ["Count", "Share"],
    items.map(([key, value]) => [STATUS_LABELS[key] ?? key, [String(value), `${Math.round((value / total) * 100)}%`]]),
  );

  return figure(
    opts.caption,
    `<svg viewBox="0 0 ${W} ${barH}" width="100%" preserveAspectRatio="none" aria-hidden="true" focusable="false">${segments}</svg>`,
    table,
    `<div class="pk-chart__legend">${legend}</div>`,
  );
}

function horizontalGrid(
  width: number,
  paddingLeft: number,
  paddingRight: number,
  paddingTop: number,
  chartHeight: number,
  maxValue: number,
): string {
  let output = "";
  for (let grid = 1; grid <= 3; grid++) {
    const y = paddingTop + chartHeight - (grid / 3) * chartHeight;
    output += `<line x1="${paddingLeft}" y1="${y.toFixed(1)}" x2="${(width - paddingRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`;
    output += `<text x="${(paddingLeft - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${AXIS_INK}" font-family="inherit">${Math.round((grid / 3) * maxValue)}</text>`;
  }
  return output;
}

export function svgBarChart(
  labels: string[],
  values: number[],
  opts: ChartCaption & { color?: string; valueHeader?: string },
): string {
  const n = labels.length;
  if (!n) return noData();
  const W = 460;
  const H = 140;
  const pL = 26;
  const pR = 8;
  const pT = 18;
  const pB = 24;
  const chartW = W - pL - pR;
  const chartH = H - pT - pB;
  const maxVal = Math.max(...values, 1);
  const slotW = chartW / n;
  const barW = Math.max(2, slotW - 3);
  const color = opts.color ?? CHART_SERIES_TOKENS[0];
  const step = Math.max(1, Math.ceil(n / 10));

  let out = horizontalGrid(W, pL, pR, pT, chartH, maxVal);
  for (let i = 0; i < n; i++) {
    const x = pL + i * slotW + 1.5;
    const barH = values[i] === 0 ? 0 : Math.max(2, (values[i] / maxVal) * chartH);
    const y = pT + chartH - barH;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"/>`;
    if (values[i] > 0 && barH > 14) {
      out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${VALUE_INK}" font-family="inherit">${values[i]}</text>`;
    }
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(pT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${AXIS_INK}" font-family="inherit">${esc(labels[i])}</text>`;
    }
  }

  const table = dataTable(
    opts.caption,
    "Period",
    [opts.valueHeader ?? "Count"],
    labels.map((label, i) => [label, [String(values[i] ?? 0)]]),
  );
  return figure(
    opts.caption,
    `<svg class="pk-chart__plot" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${out}</svg>`,
    table,
  );
}

export function svgLineChart(
  series: Array<{ label: string; values: number[]; stroke: string; area: string }>,
  xLabels: string[],
  opts: ChartCaption,
): string {
  const n = xLabels.length;
  if (!n || series.every((s) => s.values.every((v) => v === 0))) return noData();

  const W = 460;
  const H = 120;
  const pL = 28;
  const pR = 8;
  const pT = 12;
  const pB = 24;
  const chartW = W - pL - pR;
  const chartH = H - pT - pB;
  const maxVal = Math.max(...series.flatMap((s) => s.values), 1);
  const step = Math.max(1, Math.ceil(n / 12));
  const px = (i: number) => pL + (i / Math.max(1, n - 1)) * chartW;
  const py = (v: number) => pT + chartH - (v / maxVal) * chartH;

  let out = horizontalGrid(W, pL, pR, pT, chartH, maxVal);
  for (let i = 0; i < n; i++) {
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${px(i).toFixed(1)}" y="${(pT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${AXIS_INK}" font-family="inherit">${esc(xLabels[i])}</text>`;
    }
  }
  for (const s of series) {
    const areaPath =
      `M ${px(0).toFixed(1)},${(pT + chartH).toFixed(1)} ` +
      s.values.map((v, i) => `L ${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ") +
      ` L ${px(n - 1).toFixed(1)},${(pT + chartH).toFixed(1)} Z`;
    out += `<path d="${areaPath}" fill="${s.area}"/>`;
    out += `<polyline points="${s.values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  const legend = series
    .map(
      (s) =>
        `<span class="pk-chart__key">` +
        `<svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true" focusable="false">` +
        `<line x1="0" y1="2" x2="14" y2="2" stroke="${s.stroke}" stroke-width="2.5" stroke-linecap="round"/></svg>` +
        `${esc(s.label)}</span>`,
    )
    .join("");

  const table = dataTable(
    opts.caption,
    "Date",
    series.map((s) => s.label),
    xLabels.map((label, i) => [label, series.map((s) => String(s.values[i] ?? 0))]),
  );

  return figure(
    opts.caption,
    `<svg class="pk-chart__plot" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${out}</svg>`,
    table,
    `<div class="pk-chart__legend">${legend}</div>`,
  );
}

export function recentActivityChart(activity: Array<{ date: string; registrations: number; invites: number }>): string {
  return svgLineChart(
    [
      {
        label: "Registrations",
        values: activity.map((day) => day.registrations),
        stroke: "var(--pk-ok)",
        area: "color-mix(in oklab, var(--pk-ok) 8%, transparent)",
      },
      {
        label: "Invites",
        values: activity.map((day) => day.invites),
        stroke: "var(--pk-warn)",
        area: "color-mix(in oklab, var(--pk-warn) 8%, transparent)",
      },
    ],
    activity.map((day) => day.date.slice(5)),
    { caption: "Registrations and invites over the last 30 days" },
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function svgStackedBarChart(
  labels: string[],
  series: Array<{ label: string; values: number[]; color: string }>,
  opts: ChartCaption & { isoLabels?: string[]; valueFormatter?: (value: number) => string },
): string {
  const n = labels.length;
  if (!n || series.length === 0) return noData();

  const hasIso = (opts.isoLabels?.length ?? 0) === n;
  const W = 460;
  const pL = 30;
  const pR = 8;
  const pT = 18;
  const pB = hasIso ? 40 : 28;
  const chartH = 114;
  const H = pT + chartH + pB;
  const chartW = W - pL - pR;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const maxVal = Math.max(...totals, 1);
  const slotW = chartW / n;
  const barW = Math.max(2, slotW - 3);
  const step = Math.max(1, Math.ceil(n / 12));
  const gridSteps = 3;
  const fmtVal = opts.valueFormatter ?? ((value: number) => String(Math.round(value)));
  const dayOfWeek = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

  let out = "";
  for (let g = 1; g <= gridSteps; g++) {
    const gy = pT + chartH - (g / gridSteps) * chartH;
    out += `<line x1="${pL}" y1="${gy.toFixed(1)}" x2="${(W - pR).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${(pL - 3).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${AXIS_INK}" font-family="inherit">${esc(fmtVal((g / gridSteps) * maxVal))}</text>`;
  }

  if (hasIso) {
    for (let i = 0; i < n; i++) {
      const iso = opts.isoLabels![i];
      if (!iso) continue;
      const dow = dayOfWeek(iso);
      if (dow === 0 || dow === 6) {
        out += `<rect x="${(pL + i * slotW).toFixed(1)}" y="${pT}" width="${slotW.toFixed(1)}" height="${chartH}" fill="${BAND}"/>`;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const x = pL + i * slotW + 1.5;
    const cx = (x + barW / 2).toFixed(1);
    let yBase = pT + chartH;
    for (const s of series) {
      const value = s.values[i] ?? 0;
      if (value <= 0) continue;
      const segH = Math.max(1, (value / maxVal) * chartH);
      yBase -= segH;
      out += `<rect x="${x.toFixed(1)}" y="${yBase.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${s.color}" rx="1"/>`;
    }
    const total = totals[i];
    if (total > 0 && pT + chartH - yBase > 14) {
      out += `<text x="${cx}" y="${(yBase - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="${VALUE_INK}" font-family="inherit">${esc(fmtVal(total))}</text>`;
    }
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${cx}" y="${(pT + chartH + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="${AXIS_INK}" font-family="inherit">${esc(labels[i])}</text>`;
      if (hasIso) {
        const dow = dayOfWeek(opts.isoLabels![i]);
        const isWeekend = dow === 0 || dow === 6;
        out += `<text x="${cx}" y="${(pT + chartH + 24).toFixed(1)}" text-anchor="middle" font-size="8" fill="${isWeekend ? FAINT_INK : AXIS_INK}" font-family="inherit">${WEEKDAYS[dow]}</text>`;
      }
    }
    if (total > 0) {
      const tip: string[] = [hasIso ? `${opts.isoLabels![i]} (${WEEKDAYS[dayOfWeek(opts.isoLabels![i])]})` : labels[i]];
      for (const s of series) {
        const value = s.values[i] ?? 0;
        if (value > 0) tip.push(`${s.label}: ${fmtVal(value)}`);
      }
      tip.push(`Total: ${fmtVal(total)}`);
      out += `<rect x="${(pL + i * slotW).toFixed(1)}" y="${pT}" width="${slotW.toFixed(1)}" height="${chartH}" fill="transparent"><title>${esc(tip.join("\n"))}</title></rect>`;
    }
  }

  const legend = series.map((s) => legendSwatch(s.color, s.label)).join("");
  const table = dataTable(
    opts.caption,
    hasIso ? "Date" : "Category",
    [...series.map((s) => s.label), "Total"],
    labels.map((label, i) => [
      hasIso ? opts.isoLabels![i] : label,
      [...series.map((s) => fmtVal(s.values[i] ?? 0)), fmtVal(totals[i])],
    ]),
  );

  return figure(
    opts.caption,
    `<svg class="pk-chart__plot" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${out}</svg>`,
    table,
    `<div class="pk-chart__legend">${legend}</div>`,
  );
}
