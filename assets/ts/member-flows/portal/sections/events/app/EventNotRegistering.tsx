/**
 * Reached from the reminder for an unfinished registration: the person says
 * they will not register, and may say why. The reminders stop either way.
 */
import { useState } from "preact/hooks";
import {
  ownUnfinishedRegistrationSchema,
  unfinishedRegistrationStopSchema,
} from "../../../../../../shared/schemas/unfinished-registrations";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import {
  UNFINISHED_REGISTRATION_REASONS,
  UNFINISHED_REGISTRATION_REASON_LABELS,
  type UnfinishedRegistrationReason,
} from "../../../../../../shared/unfinished-registrations";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { useData } from "../../../../../hooks/useData";
import { getJson, postJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../../ui/Button";
import { Radio } from "../../../../../ui/Checkbox";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Spinner } from "../../../../../ui/Spinner";
import { Textarea } from "../../../../../ui/TextControl";
import { usePortalHashLocation } from "../../../hash-location";

export function EventNotRegistering({ slug }: { slug: string }) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/registrations/unfinished/current`;
  const own = useData(() => getJson(base, ownUnfinishedRegistrationSchema), [slug]);
  const [reasonCode, setReasonCode] = useState<UnfinishedRegistrationReason | undefined>();
  const [reasonNote, setReasonNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(unfinishedRegistrationStopSchema, { reasonCode, reasonNote: reasonNote || undefined });
  const eventHref = usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}`);
  const registerHref = usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}/register`);

  if (own.loading) return <Spinner label="Loading…" />;
  if (!own.data) return <Alert tone="danger">{own.error}</Alert>;
  const { eventName, state } = own.data;

  async function stop(event: Event) {
    event.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await postJson(`${base}/stop`, checked.data, successResponseSchema);
      setStopped(true);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  if (stopped || state === "stopped")
    return (
      <Panel aria-label="Not registering">
        <PanelHeader title="We won’t remind you again" />
        <PanelBody class="pk-stack">
          <p>
            {stopped ? "Thank you for telling us. " : ""}You can still register for {eventName} while registration is
            open.
          </p>
          <div class="pk-cluster">
            <ButtonLink href={registerHref}>Register after all</ButtonLink>
            <ButtonLink variant="link" href={eventHref}>
              Back to the event
            </ButtonLink>
          </div>
        </PanelBody>
      </Panel>
    );
  if (state !== "unfinished")
    return (
      <Panel aria-label="Not registering">
        <PanelHeader
          title={state === "registered" ? `You’re registered for ${eventName}` : "There is nothing to stop"}
        />
        <PanelBody class="pk-stack">
          <p>
            {state === "registered"
              ? "You finished registering, so there are no reminders to stop."
              : `You have no unfinished registration for ${eventName}, so we are not sending you reminders.`}
          </p>
          <div class="pk-cluster">
            <ButtonLink href={eventHref}>Back to the event</ButtonLink>
          </div>
        </PanelBody>
      </Panel>
    );
  return (
    <Panel aria-label="Not registering">
      <PanelHeader title={`Not registering for ${eventName}?`} />
      <PanelBody>
        <form class="pk-stack pk-stack--loose" noValidate {...form.handlers} onSubmit={(event) => void stop(event)}>
          <p>We will stop reminding you. If you tell us why, the organizers can do better next time.</p>
          <Field group label="What stopped you?" help="Optional" {...form.ofGroup("reasonCode")}>
            {() => (
              <div class="pk-stack pk-stack--snug">
                {UNFINISHED_REGISTRATION_REASONS.map((reason) => (
                  <Radio
                    key={reason}
                    name="reasonCode"
                    value={reason}
                    checked={reasonCode === reason}
                    onChange={() => setReasonCode(reason)}
                    label={UNFINISHED_REGISTRATION_REASON_LABELS[reason]}
                  />
                ))}
              </div>
            )}
          </Field>
          <Field label="Anything to add?" help="Optional" {...form.of("reasonNote")}>
            {(control) => (
              <Textarea
                {...control}
                name="reasonNote"
                rows={3}
                value={reasonNote}
                onInput={(event) => setReasonNote(event.currentTarget.value)}
              />
            )}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              Stop reminders
            </Button>
            <ButtonLink variant="link" href={registerHref}>
              Finish registering instead
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
