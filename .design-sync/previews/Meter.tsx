import type * as React from "react";
import { Meter } from "pkic-org-events-backend";

/**
 * `label` is the accessible name only — the bar itself draws nothing. A real
 * surface pairs each meter with its own visible label, so these previews do
 * the same rather than teaching an unlabeled bar.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div class="pk-stack pk-stack--tight">
      <span class="pk-small pk-muted">{label}</span>
      {children}
    </div>
  );
}

export function Tones() {
  return (
    <div class="pk pk-stack">
      <Row label="Charters signed">
        <Meter label="Charters signed" value={41} max={52} tone="ok" showValue />
      </Row>
      <Row label="Seats used">
        <Meter label="Seats used" value={38} max={40} tone="warn" showValue />
      </Row>
      <Row label="Certificates expiring">
        <Meter label="Certificates expiring" value={12} max={12} tone="danger" showValue />
      </Row>
      <Row label="Review progress">
        <Meter label="Review progress" value={17} max={30} tone="accent" showValue />
      </Row>
    </div>
  );
}

export function WithoutValue() {
  return (
    <div class="pk">
      <Row label="Storage used">
        <Meter label="Storage used" value={640} max={1024} />
      </Row>
    </div>
  );
}

/**
 * The in-cell size, as the roster's attendance column uses it: a fixed track
 * with the figure beside it, so the column stays the width of its numbers.
 */
export function InATableCell() {
  const rows = [
    { group: "CBOM Profiles WG", attended: 18, held: 18, tone: "ok" as const },
    { group: "Post-Quantum Cryptography WG", attended: 9, held: 12, tone: "warn" as const },
    { group: "Training and Certification WG", attended: 6, held: 11, tone: "danger" as const },
  ];
  return (
    <div class="pk pk-stack pk-stack--tight">
      {rows.map((row) => (
        <div key={row.group} class="pk-cluster pk-cluster--between">
          <span class="pk-small">{row.group}</span>
          <Meter
            size="sm"
            label={`${String(row.attended)} of ${String(row.held)} meetings attended`}
            value={row.attended}
            max={row.held}
            tone={row.tone}
            showValue
          />
        </div>
      ))}
    </div>
  );
}
