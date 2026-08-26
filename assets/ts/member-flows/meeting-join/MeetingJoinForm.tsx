import { useState } from "preact/hooks";
import type { z } from "zod";
import type { meetingJoinLandingSchema } from "../../../shared/schemas/event-series";

type MeetingJoinLanding = z.infer<typeof meetingJoinLandingSchema>;

export function MeetingJoinForm({
  landing,
  submitting,
  error,
  onJoin,
}: {
  landing: MeetingJoinLanding;
  submitting: boolean;
  error: string | null;
  onJoin: (acceptedTermIds: string[]) => void;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(landing.terms.filter((term) => term.accepted).map((term) => term.id)),
  );
  const missingRequired = landing.terms.some((term) => term.required && !term.accepted && !accepted.has(term.id));

  return (
    <div class="card shadow-sm">
      <div class="card-body p-4">
        <h1 class="h4 mb-1">{landing.occurrence.eventName}</h1>
        <p class="text-muted mb-3">
          {new Date(landing.occurrence.startsAt).toLocaleString()} · {landing.occurrence.location ?? "Online"}
        </p>
        <dl class="row small mb-4">
          <dt class="col-sm-3">Attendee</dt>
          <dd class="col-sm-9">{landing.name}</dd>
          <dt class="col-sm-3">Affiliation</dt>
          <dd class="col-sm-9">{landing.affiliation ?? "Not specified"}</dd>
        </dl>

        {landing.terms.length > 0 && <h2 class="h6">Meeting terms</h2>}
        {landing.terms.map((term) => (
          <div class="form-check mb-3" key={term.id}>
            <input
              class="form-check-input"
              id={`meeting-term-${term.id}`}
              type="checkbox"
              checked={term.accepted || accepted.has(term.id)}
              disabled={term.accepted || submitting}
              required={term.required}
              onChange={(event) => {
                const next = new Set(accepted);
                if (event.currentTarget.checked) next.add(term.id);
                else next.delete(term.id);
                setAccepted(next);
              }}
            />
            <label class="form-check-label" for={`meeting-term-${term.id}`}>
              {term.displayText}
              {term.required ? " (required)" : ""}
            </label>
          </div>
        ))}

        {error && <div class="alert alert-danger">{error}</div>}
        <button
          class="btn btn-primary"
          type="button"
          disabled={submitting || missingRequired}
          onClick={() => onJoin([...accepted])}
        >
          {submitting ? "Opening meeting…" : "Agree and join meeting"}
        </button>
      </div>
    </div>
  );
}
