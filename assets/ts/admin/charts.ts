import { esc } from "./ui";

export function statusBars(byStatus: Record<string, number>, total: number): string {
  if (!total) return '<p class="text-muted fst-italic small">No data</p>';
  return Object.entries(byStatus)
    .map(([k, v]) => {
      const pct = Math.round((v / total) * 100);
      return (
        `<div class="bar-row"><span class="bar-lbl">${esc(k)}</span>` +
        `<div class="bar-track"><div class="bar-fill ${esc(k)}" style="width:${pct}%"></div></div>` +
        `<span class="bar-cnt">${v}</span></div>`
      );
    })
    .join("");
}

export function svgStatusSegmentBar(byStatus: Record<string, number>, total: number): string {
  if (!total) return '<p class="text-muted fst-italic small">No data</p>';
  const STATUS_ORDER = ["registered", "pending_email_confirmation", "waitlisted", "cancelled"];
  const STATUS_COLORS: Record<string, string> = {
    registered: "#198754",
    pending_email_confirmation: "#fd7e14",
    waitlisted: "#0dcaf0",
    cancelled: "#dc3545",
  };
  const STATUS_LABELS: Record<string, string> = {
    registered: "Confirmed",
    pending_email_confirmation: "Pending",
    waitlisted: "Waitlisted",
    cancelled: "Cancelled",
  };
  const W = 460, barH = 20, radius = 4;
  let x = 0;
  let segments = "";
  const sorted = [...STATUS_ORDER, ...Object.keys(byStatus).filter((k) => !STATUS_ORDER.includes(k))];
  const items = sorted.map((k) => [k, byStatus[k] ?? 0] as [string, number]).filter(([, v]) => v > 0);
  items.forEach(([k, v], idx) => {
    const segW = (v / total) * W;
    const color = STATUS_COLORS[k] ?? "#6c757d";
    const lbl = STATUS_LABELS[k] ?? k;
    const pct = Math.round((v / total) * 100);
    const title = `${lbl}: ${v} (${pct}%)`;
    const isFirst = idx === 0, isLast = idx === items.length - 1;
    if (isFirst && isLast) {
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="${barH}" fill="${color}" rx="${radius}"><title>${esc(title)}</title></rect>`;
    } else if (isFirst) {
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="${barH}" fill="${color}" rx="${radius}"><title>${esc(title)}</title></rect>`;
      segments += `<rect x="${(x + segW - radius).toFixed(2)}" y="0" width="${radius}" height="${barH}" fill="${color}"/>`;
    } else if (isLast) {
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="${barH}" fill="${color}" rx="${radius}"><title>${esc(title)}</title></rect>`;
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${radius}" height="${barH}" fill="${color}"/>`;
    } else {
      segments += `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="${barH}" fill="${color}"><title>${esc(title)}</title></rect>`;
    }
    x += segW;
  });
  const legend = items
    .map(([k, v]) => {
      const pct = Math.round((v / total) * 100);
      const color = STATUS_COLORS[k] ?? "#6c757d";
      const lbl = STATUS_LABELS[k] ?? k;
      return `<span class="adm-chart-legend-item">` +
        `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${color}"/></svg>` +
        `${esc(lbl)}: <strong>${v}</strong> <span class="text-muted">(${pct}%)</span></span>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${W} ${barH}" width="100%" preserveAspectRatio="none" aria-hidden="true">${segments}</svg>` +
    `<div class="adm-chart-legend mt-2">${legend}</div>`
  );
}

export function fmtMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  });
}

export function svgBarChart(
  labels: string[],
  values: number[],
  opts: { color?: string } = {},
): string {
  const n = labels.length;
  if (!n) return '<p class="text-muted fst-italic small">No data</p>';
  const W = 460, H = 140;
  const pL = 26, pR = 8, pT = 18, pB = 24;
  const chartW = W - pL - pR, chartH = H - pT - pB;
  const maxVal = Math.max(...values, 1);
  const slotW = chartW / n;
  const barW = Math.max(2, slotW - 3);
  const color = opts.color ?? "#198754";
  const step = Math.max(1, Math.ceil(n / 10));
  const gridSteps = 3;
  let out = "";
  for (let g = 1; g <= gridSteps; g++) {
    const gy = pT + chartH - (g / gridSteps) * chartH;
    out += `<line x1="${pL}" y1="${gy.toFixed(1)}" x2="${(W - pR).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#e9ecef" stroke-width="1"/>`;
    out += `<text x="${(pL - 3).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#6c757d" font-family="inherit">${Math.round((g / gridSteps) * maxVal)}</text>`;
  }
  for (let i = 0; i < n; i++) {
    const x = pL + i * slotW + 1.5;
    const barH = values[i] === 0 ? 0 : Math.max(2, (values[i] / maxVal) * chartH);
    const y = pT + chartH - barH;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"/>`;
    if (values[i] > 0 && barH > 14) {
      out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="#212529" font-family="inherit">${values[i]}</text>`;
    }
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${(x + barW / 2).toFixed(1)}" y="${(pT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6c757d" font-family="inherit">${esc(labels[i])}</text>`;
    }
  }
  return `<svg class="adm-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg>`;
}

export function svgLineChart(
  series: Array<{ label: string; values: number[]; stroke: string; area: string }>,
  xLabels: string[],
): string {
  const n = xLabels.length;
  if (!n || series.every((s) => s.values.every((v) => v === 0))) {
    return '<p class="text-muted fst-italic small">No data</p>';
  }
  const W = 460, H = 120;
  const pL = 28, pR = 8, pT = 12, pB = 24;
  const chartW = W - pL - pR, chartH = H - pT - pB;
  const maxVal = Math.max(...series.flatMap((s) => s.values), 1);
  const step = Math.max(1, Math.ceil(n / 12));
  const px = (i: number) => pL + (i / Math.max(1, n - 1)) * chartW;
  const py = (v: number) => pT + chartH - (v / maxVal) * chartH;
  const gridSteps = 3;
  let out = "";
  for (let g = 1; g <= gridSteps; g++) {
    const gy = pT + chartH - (g / gridSteps) * chartH;
    out += `<line x1="${pL}" y1="${gy.toFixed(1)}" x2="${(W - pR).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#e9ecef" stroke-width="1"/>`;
    out += `<text x="${(pL - 3).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#6c757d" font-family="inherit">${Math.round((g / gridSteps) * maxVal)}</text>`;
  }
  for (let i = 0; i < n; i++) {
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${px(i).toFixed(1)}" y="${(pT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6c757d" font-family="inherit">${esc(xLabels[i])}</text>`;
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
        `<span class="adm-chart-legend-item"><svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2" stroke="${s.stroke}" stroke-width="2.5" stroke-linecap="round"/></svg>${esc(s.label)}</span>`,
    )
    .join("");
  return (
    `<svg class="adm-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg>` +
    `<div class="adm-chart-legend">${legend}</div>`
  );
}

/** Returns every ISO date string (YYYY-MM-DD) from `from` to `to` inclusive. */
export function isoDateRange(from: string, to: string): string[] {
  const result: string[] = [];
  const end = new Date(`${to}T12:00:00Z`);
  const cur = new Date(`${from}T12:00:00Z`);
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

export function svgStackedBarChart(
  labels: string[],
  series: Array<{ label: string; values: number[]; color: string }>,
  opts?: { isoLabels?: string[] },
): string {
  const n = labels.length;
  if (!n || series.length === 0) return '<p class="text-muted fst-italic small">No data</p>';
  const hasIso = (opts?.isoLabels?.length ?? 0) === n;
  const WKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const W = 460;
  const pL = 30, pR = 8, pT = 18;
  const pB = hasIso ? 40 : 28;
  const H = pT + 114 + pB;
  const chartH = 114;
  const chartW = W - pL - pR;
  const totals = labels.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] ?? 0), 0));
  const maxVal = Math.max(...totals, 1);
  const slotW = chartW / n;
  const barW = Math.max(2, slotW - 3);
  const step = Math.max(1, Math.ceil(n / 12));
  const gridSteps = 3;
  let out = "";
  for (let g = 1; g <= gridSteps; g++) {
    const gy = pT + chartH - (g / gridSteps) * chartH;
    out += `<line x1="${pL}" y1="${gy.toFixed(1)}" x2="${(W - pR).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#e9ecef" stroke-width="1"/>`;
    out += `<text x="${(pL - 3).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#6c757d" font-family="inherit">${Math.round((g / gridSteps) * maxVal)}</text>`;
  }
  if (hasIso) {
    for (let i = 0; i < n; i++) {
      const iso = opts!.isoLabels![i];
      if (!iso) continue;
      const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) {
        out += `<rect x="${(pL + i * slotW).toFixed(1)}" y="${pT}" width="${slotW.toFixed(1)}" height="${chartH}" fill="#f8f6f6" rx="0"/>`;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const x = pL + i * slotW + 1.5;
    const cx = (x + barW / 2).toFixed(1);
    let yBase = pT + chartH;
    for (const sr of series) {
      const v = sr.values[i] ?? 0;
      if (v <= 0) continue;
      const segH = Math.max(1, (v / maxVal) * chartH);
      yBase -= segH;
      out += `<rect x="${x.toFixed(1)}" y="${yBase.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${sr.color}" rx="1"/>`;
    }
    const total = totals[i];
    if (total > 0 && (pT + chartH - yBase) > 14) {
      out += `<text x="${cx}" y="${(yBase - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="#212529" font-family="inherit">${total}</text>`;
    }
    if (i % step === 0 || i === n - 1) {
      out += `<text x="${cx}" y="${(pT + chartH + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6c757d" font-family="inherit">${esc(labels[i])}</text>`;
      if (hasIso) {
        const iso = opts!.isoLabels![i];
        const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        out += `<text x="${cx}" y="${(pT + chartH + 24).toFixed(1)}" text-anchor="middle" font-size="8" fill="${isWeekend ? "#ced4da" : "#adb5bd"}" font-family="inherit">${WKDAYS[dow]}</text>`;
      }
    }
    if (total > 0) {
      const tipLines: string[] = [];
      if (hasIso) {
        const iso = opts!.isoLabels![i];
        const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
        tipLines.push(`${iso} (${WKDAYS[dow]})`);
      } else {
        tipLines.push(labels[i]);
      }
      for (const sr of series) {
        const v = sr.values[i] ?? 0;
        if (v > 0) tipLines.push(`${sr.label}: ${v}`);
      }
      tipLines.push(`Total: ${total}`);
      out += `<rect x="${(pL + i * slotW).toFixed(1)}" y="${pT}" width="${slotW.toFixed(1)}" height="${chartH}" fill="transparent" data-tip="${esc(tipLines.join("\n"))}"/>`;
    }
  }
  const legend = series
    .map((sr) =>
      `<span class="adm-chart-legend-item"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${sr.color}"/></svg>${esc(sr.label)}</span>`,
    )
    .join("");
  return (
    `<svg class="adm-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg>` +
    `<div class="adm-chart-legend">${legend}</div>`
  );
}
