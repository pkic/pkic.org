/** The event's own guidance on the ticket step: one line above the tickets, one above the days. */
import { useState } from "preact/hooks";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import { Alert } from "../../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../../ui/EditActions";
import { Field } from "../../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { Textarea } from "../../../../../../../ui/TextControl";
import { useTicketSettingsForm } from "./ticket-settings-form";

export function TicketStepTextsPanel({
  slug,
  configuration,
  canWrite,
  onSaved,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const saved = configuration.settings;
  const [ticketIntro, setTicketIntro] = useState(saved.ticketIntro);
  const [attendanceIntro, setAttendanceIntro] = useState(saved.attendanceIntro);
  const { form, editing, saving, error, save, edit, cancel } = useTicketSettingsForm(
    slug,
    configuration.revision,
    {
      currency: saved.currency,
      reminderIntervalDays: saved.reminderIntervalDays,
      reminderPeriodDays: saved.reminderPeriodDays,
      unpaidHoldDays: saved.unpaidHoldDays,
      sendInvoice: saved.sendInvoice,
      refundDaysBeforeEvent: saved.refundDaysBeforeEvent,
      refundFee: saved.refundFee,
      ticketIntro,
      attendanceIntro,
    },
    onSaved,
    () => {
      setTicketIntro(saved.ticketIntro);
      setAttendanceIntro(saved.attendanceIntro);
    },
  );
  return (
    <Panel aria-label="Guidance for registrants">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Guidance for registrants">
          {canWrite && (
            <EditActions
              label="Guidance actions"
              editing={editing}
              saving={saving}
              saveLabel="Save guidance"
              editLabel="Edit guidance"
              onEdit={edit}
              onCancel={cancel}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <>
              <Field
                {...form.of("ticketIntro")}
                label="Above the tickets"
                help="Shown when people choose their ticket. Say what the choice depends on."
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="ticketIntro"
                    rows={2}
                    value={ticketIntro}
                    onInput={(event) => setTicketIntro(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("attendanceIntro")}
                label="Above the days"
                help="Shown above the attendance choices. Say what a ticket covers."
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="attendanceIntro"
                    rows={2}
                    value={attendanceIntro}
                    onInput={(event) => setAttendanceIntro(event.currentTarget.value)}
                  />
                )}
              </Field>
            </>
          ) : (
            <DescriptionList
              items={[
                { term: "Above the tickets", value: saved.ticketIntro },
                { term: "Above the days", value: saved.attendanceIntro },
              ]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
