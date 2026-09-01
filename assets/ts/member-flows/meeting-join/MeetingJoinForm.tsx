import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import type { meetingJoinLandingSchema } from "../../../shared/schemas/event-series";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Panel, PanelBody } from "../../ui/Panel";
import { formatDateTime } from "../../shared/ui";
// `pk-check`, `pk-check__input` and `pk-check__label` are written here as
// class names rather than reached through `ui/Field`, and `pk-datalist` the
// same way, so this module pulls both stylesheets into its own chunk. Without
// them the terms render as operating-system default checkboxes.
import "../../ui/Field.css";
import "../../ui/Content.css";

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
    <div class="pk">
      <Panel>
        <PanelBody class="pk-stack">
          <div class="pk-stack pk-stack--tight">
            <h1>{landing.occurrence.eventName}</h1>
            <p class="pk-muted">
              {formatDateTime(landing.occurrence.startsAt)} · {landing.occurrence.location ?? "Online"}
            </p>
          </div>

          <dl class="pk-datalist pk-small">
            <dt>Attendee</dt>
            <dd>{landing.name}</dd>
            <dt>Affiliation</dt>
            <dd>{landing.affiliation ?? "Not specified"}</dd>
          </dl>

          {landing.terms.length > 0 && (
            <div class="pk-stack pk-stack--snug">
              <h2>Meeting terms</h2>
              {landing.terms.map((term) => (
                <Fragment key={term.id}>
                  {/* The label wraps the control, so the two are bound without
                      a `for`/`id` pair to keep in step. All three parts of the
                      check block are present: a label carrying only the block
                      class renders the operating system's own checkbox. */}
                  <label class="pk-check">
                    <input
                      class="pk-check__input"
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
                    <span class="pk-check__label">
                      {term.displayText}
                      {term.required ? " (required)" : ""}
                    </span>
                  </label>
                </Fragment>
              ))}
            </div>
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          <div class="pk-cluster">
            <Button
              variant="primary"
              loading={submitting}
              disabled={submitting || missingRequired}
              onClick={() => onJoin([...accepted])}
            >
              {submitting ? "Opening meeting…" : "Agree and join meeting"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
