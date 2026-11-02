/**
 * Ends one representation as of a date: the quick action behind "End
 * representation…" for the identity's owner and for whoever manages it.
 *
 * A representation often ended before anyone records it, so the dialog asks
 * when. The date is a calendar day in the viewer's zone; it becomes an instant
 * here, at the presentation boundary: today sends none (the server records the
 * moment it saves), an earlier day sends the end of that day. The contract the
 * route parses checks it, so a day in the future is refused at the field.
 */
import { useRef, useState } from "preact/hooks";
import { z } from "zod";

import { identityEndedAtSchema } from "../../../shared/schemas/identity";
import { dateTimeLocalToIso, instantToCalendarDate, viewerTimeZone } from "../../../shared/timezone";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

const endDateSchema = z.object({ endedAt: identityEndedAtSchema.optional() });

/** The instant a chosen day ends, or undefined for today. */
function endedAtFor(day: string, today: string, timeZone: string): string | undefined {
  if (day === today) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return dateTimeLocalToIso(`${day}T23:59`, timeZone);
}

/**
 * What ending takes away, said from the viewer's side: "you" for the owner, the
 * person's name for a manager. Losing the power to act for the organization
 * leads; the person's sign-in and other identities are not the news here.
 */
function endRepresentationCopy(organizationName: string, subjectName: string | null) {
  const own = subjectName === null;
  const subject = own ? "you" : "they";
  const their = own ? "Your" : "Their";
  return {
    title: own
      ? `End your representation of ${organizationName}?`
      : `End ${subjectName}'s representation of ${organizationName}?`,
    description: `From the end date, ${subject} can no longer act for ${organizationName}.`,
    consequences: [
      `${their} permissions and roles through ${organizationName} end`,
      `${their} group seats for ${organizationName} end on that date`,
      own
        ? "Ended by mistake? You can reinstate it by confirming your work email address"
        : "Ended by mistake? You can reinstate it from their past identities",
    ],
  };
}

export function EndRepresentationDialog({
  organizationName,
  subjectName,
  startedAt,
  onEnd,
  onClose,
}: {
  organizationName: string;
  /** The person whose representation ends; null when it is the viewer's own. */
  subjectName: string | null;
  /** When the representation began; the end date can't come before it. */
  startedAt: string | null;
  /** Ends it; a refusal is thrown and shown in the dialog. */
  onEnd: (endedAt: string | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const { title, description, consequences } = endRepresentationCopy(organizationName, subjectName);
  const timeZone = viewerTimeZone();
  const today = instantToCalendarDate(new Date(), timeZone);
  const [day, setDay] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(endDateSchema, { endedAt: endedAtFor(day, today, timeZone) });
  const root = useRef<HTMLDivElement>(null);

  async function end(): Promise<void> {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onEnd(checked.data.endedAt);
      onClose();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      destructive
      title={title}
      description={description}
      consequences={consequences}
      closeLabel="Close end representation"
      confirmLabel={saving ? "Ending…" : "End representation"}
      confirmDisabled={saving}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      <div ref={root}>
        <form
          noValidate
          class="pk-stack pk-stack--snug"
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            void end();
          }}
        >
          <fieldset class="pk-fieldset" disabled={saving}>
            <Field label="Ended on" required {...form.of("endedAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="endedAt"
                  type="date"
                  value={day}
                  min={startedAt ? instantToCalendarDate(startedAt, timeZone) : undefined}
                  max={today}
                  onInput={(event) => setDay(event.currentTarget.value)}
                />
              )}
            </Field>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </div>
    </Dialog>
  );
}
