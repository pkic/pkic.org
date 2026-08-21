import { fmt } from "../../ui";
import type { AdminApplicationDetail } from "../../types";

export function ApplicationConcernsCard({ detail }: { detail: AdminApplicationDetail }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Consultation concerns</div>
      <div class="card-body">
        <ul class="list-unstyled small mb-0">
          {detail.concerns.map((c) => (
            <li key={c.id} class="mb-2">
              {c.concernText}
              <div class="mono text-muted small">{fmt(c.createdAt)}</div>
            </li>
          ))}
          {detail.concerns.length === 0 && <li class="text-muted">None submitted.</li>}
        </ul>
      </div>
    </div>
  );
}
