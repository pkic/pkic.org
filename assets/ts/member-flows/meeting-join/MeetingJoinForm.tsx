import { useState } from "preact/hooks";
import type { z } from "zod";
import { meetingJoinConfirmSchema, type MeetingJoinLanding } from "../../../shared/schemas/meeting-entry";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Panel, PanelBody } from "../../ui/Panel";
import { formatDateTime } from "../../shared/ui";
// `pk-datalist` is written here as a class name rather than reached through a
// component, so this module pulls its stylesheet into its own chunk.
import "../../ui/Content.css";

export type MeetingJoinConfirmInput = z.output<typeof meetingJoinConfirmSchema>;

/** The join body the landing and the reader's choices make, as the contract reads it. */
function joinBody(landing: MeetingJoinLanding, accepted: Set<string>) {
  return {
    landingRevision: landing.landingRevision,
    acceptedTerms: landing.terms
      .filter((term) => accepted.has(term.id) && !term.accepted)
      .map((term) => ({ termId: term.id, version: term.version })),
    intentionalJoin: true,
  };
}

export function MeetingJoinForm({
  landing,
  submitting,
  error,
  onJoin,
}: {
  landing: MeetingJoinLanding;
  submitting: boolean;
  error: string | null;
  onJoin: (input: MeetingJoinConfirmInput) => void;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(landing.terms.filter((term) => term.accepted).map((term) => term.id)),
  );
  // The join contract the route parses is what the button may send; whether
  // every required term has been agreed is the landing's own policy.
  const form = useContractForm(meetingJoinConfirmSchema, joinBody(landing, accepted));
  const missingRequired = landing.terms.some((term) => term.required && !term.accepted && !accepted.has(term.id));

  function join(): void {
    const checked = form.submit();
    if (!checked.data) return;
    onJoin(checked.data);
  }

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
            <div class="pk-stack pk-stack--snug" {...form.handlers}>
              <h2>Meeting terms</h2>
              {landing.terms.map((term) => (
                // The design system's checkbox wraps its own label, so the two
                // are bound without a `for`/`id` pair to keep in step.
                <Checkbox
                  key={term.id}
                  id={`meeting-term-${term.id}`}
                  name="acceptedTerms"
                  label={`${term.displayText}${term.required ? " (required)" : ""}`}
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
              ))}
            </div>
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          <div class="pk-cluster">
            <Button
              variant="primary"
              loading={submitting}
              disabled={submitting || missingRequired || !form.valid}
              onClick={join}
            >
              {submitting ? "Opening meeting…" : "Agree and join meeting"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
