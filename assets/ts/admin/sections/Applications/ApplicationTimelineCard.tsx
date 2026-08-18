import { fmt } from "../../ui";
import type { AdminApplicationDetail } from "../../types";

export function ApplicationTimelineCard({ detail }: { detail: AdminApplicationDetail }) {
  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Timeline</div>
      <div class="card-body">
        <ul class="list-unstyled mb-0 small">
          {detail.events.map((ev, i) => (
            <li key={i} class="mb-1">
              <span class="mono text-muted">{fmt(ev.createdAt)}</span> — {ev.fromStage ?? "…"} → {ev.toStage}
              {ev.note && <span class="text-muted"> ({ev.note})</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
