/**
 * Layouts for unfinished registrations: the page where a person says they are
 * not registering, and the organizer's summary of why. Static until approved.
 */
import type { PreviewSection } from "./PreviewShell";
import {
  UNFINISHED_REGISTRATION_REASONS,
  UNFINISHED_REGISTRATION_REASON_LABELS,
} from "../../../shared/unfinished-registrations";
import { Button } from "../Button";
import { Radio } from "../Checkbox";
import { Field } from "../Field";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { UnfinishedRegistrationsSummary } from "../../member-flows/portal/sections/events/detail/UnfinishedRegistrations";
import { Textarea } from "../TextControl";

/** Reached from the reminder email: one decision, with the reason left to the person. */
function NotRegistering() {
  return (
    <Panel aria-label="Not registering">
      <PanelHeader title="Not registering for Example Conference?" />
      <PanelBody class="pk-stack pk-stack--loose">
        <p>We will stop reminding you. If you tell us why, the organizers can do better next time.</p>
        <Field group label="What stopped you?" help="Optional">
          {() => (
            <div class="pk-stack pk-stack--snug">
              {UNFINISHED_REGISTRATION_REASONS.map((reason) => (
                <Radio
                  key={reason}
                  name="reasonCode"
                  value={reason}
                  label={UNFINISHED_REGISTRATION_REASON_LABELS[reason]}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label="Anything to add?" help="Optional">
          {(control) => <Textarea {...control} name="reasonNote" rows={3} />}
        </Field>
        <div class="pk-cluster">
          <Button type="button" variant="primary">
            Stop reminders
          </Button>
          <Button type="button" variant="link">
            Finish registering instead
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}

/** On the event's analytics: how many stopped, and what they said. */
function UnfinishedSummary() {
  return (
    <UnfinishedRegistrationsSummary
      summary={{
        started: 212,
        registered: 164,
        reminded: 48,
        stopped: 34,
        reasons: [
          { reasonCode: "price", count: 14 },
          { reasonCode: "approval_pending", count: 9 },
          { reasonCode: "travel_not_possible", count: 6 },
          { reasonCode: null, count: 5 },
        ],
        notes: [
          {
            reasonCode: "price",
            note: "Our budget is frozen until the new fiscal year.",
            stoppedAt: "2027-03-02T10:00:00.000Z",
          },
          {
            reasonCode: "approval_pending",
            note: "Waiting for a travel approval that takes weeks.",
            stoppedAt: "2027-02-27T10:00:00.000Z",
          },
        ],
      }}
    />
  );
}

export const unfinishedRegistrationSections: PreviewSection[] = [
  { id: "not-registering", title: "Registration: not registering", render: () => <NotRegistering /> },
  { id: "unfinished-summary", title: "Registrations: unfinished", render: () => <UnfinishedSummary /> },
];
