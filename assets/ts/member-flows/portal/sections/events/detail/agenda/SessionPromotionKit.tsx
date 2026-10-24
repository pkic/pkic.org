import "./SessionPromotionKit.css";
import { useState } from "preact/hooks";
import { promotionKitSaveSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import {
  agendaSnapshotSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Textarea } from "../../../../../../ui/TextControl";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PersonalPromotionKit } from "./PersonalPromotionKit";
export function SessionPromotionKit({
  slug,
  occurrence,
  snapshot,
  onSaved,
  onClose,
}: {
  slug: string;
  occurrence: AgendaOccurrence;
  snapshot?: AgendaSnapshot;
  onSaved?: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [whyAttend, setWhy] = useState(occurrence.promotionCopy?.whyAttend ?? occurrence.description);
  const [takeaways, setTakeaways] = useState(occurrence.promotionCopy?.takeaways.join("\n") ?? "");
  const [callToAction, setCta] = useState(occurrence.promotionCopy?.callToAction ?? "Join this session");
  const [campaign, setCampaign] = useState(occurrence.promotionCopy?.campaign ?? "speaker-kit");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrence.id)}/promotion`;
  const body = {
    expectedRevision: snapshot?.revision ?? 0,
    copy: {
      whyAttend,
      takeaways: takeaways
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      callToAction,
      campaign,
      approvedAt: new Date().toISOString(),
    },
  };
  const form = useContractForm(promotionKitSaveSchema, body);
  async function approve(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved?.(await postJson(base, checked.data, agendaSnapshotSchema));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save promotion copy.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={`Promotion kit · ${occurrence.title}`}>
        <CloseButton label="Close promotion kit" onClick={onClose} />
      </PanelHeader>
      <PanelBody>
        {snapshot && (
          <form noValidate onSubmit={approve} class="pk-form">
            <p>
              Review the narrative, then approve the agenda to release this copy with its schedule and speaker credits.
            </p>
            <Field label="Why attend" {...form.of("copy.whyAttend")}>
              {(control) => <Textarea {...control} value={whyAttend} onInput={(e) => setWhy(e.currentTarget.value)} />}
            </Field>
            <Field
              label="Key questions / takeaways"
              help="Optional: one per line, up to eight specific points."
              {...form.of("copy.takeaways")}
            >
              {(control) => (
                <Textarea {...control} value={takeaways} onInput={(e) => setTakeaways(e.currentTarget.value)} />
              )}
            </Field>
            <Field label="Call to action" {...form.of("copy.callToAction")}>
              {(control) => (
                <TextInput {...control} value={callToAction} onInput={(e) => setCta(e.currentTarget.value)} />
              )}
            </Field>
            <Field label="Campaign" {...form.of("copy.campaign")}>
              {(control) => (
                <TextInput {...control} value={campaign} onInput={(e) => setCampaign(e.currentTarget.value)} />
              )}
            </Field>
            <Button type="submit" disabled={busy}>
              Approve promotion copy
            </Button>
          </form>
        )}
        {error && <ErrorAlert error={error} />}
        <PersonalPromotionKit key={snapshot?.revision} base={base} title="My published materials" />
      </PanelBody>
    </Panel>
  );
}
