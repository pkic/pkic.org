import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
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
import { Dialog } from "../../../../../../ui/Dialog";
import { Button } from "../../../../../../ui/Button";
import { IconPlus } from "../../../../../../components/icons";
import { PromotionBulkPreparation } from "./PromotionBulkPreparation";
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
  const [editing, showEditing, closeEditing] = useDialogQueryState("promotionCopy");
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
  async function approve() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    try {
      onSaved?.(await postJson(base, checked.data, agendaSnapshotSchema));
      setError("");
      await closeEditing();
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={`Promotion kit · ${occurrence.title}`}>
        {snapshot && (
          <>
            <PromotionBulkPreparation slug={slug} publishedRevision={snapshot.publishedRevision} />
            <Button
              icon
              aria-label="Edit shared promotion copy"
              title="Edit shared promotion copy"
              onClick={showEditing}
            >
              <IconPlus />
            </Button>
          </>
        )}
        <CloseButton label="Close promotion kit" onClick={onClose} />
      </PanelHeader>
      <PanelBody>
        {snapshot && editing && (
          <Dialog
            open
            title="Shared promotion copy"
            closeLabel="Close shared promotion copy"
            confirmLabel="Approve promotion copy"
            confirmDisabled={busy}
            onConfirm={() => void approve()}
            onCancel={closeEditing}
          >
            <form
              noValidate
              {...form.handlers}
              onSubmit={(event) => {
                event.preventDefault();
                void approve();
              }}
              class="pk-form"
            >
              <p>
                Review the narrative, then approve the agenda to release this copy with its schedule and speaker
                credits.
              </p>
              <Field label="Why attend" {...form.of("copy.whyAttend")}>
                {(control) => (
                  <Textarea {...control} value={whyAttend} onInput={(e) => setWhy(e.currentTarget.value)} />
                )}
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
              {error && <ErrorAlert error={error} />}
            </form>
          </Dialog>
        )}
        <PersonalPromotionKit key={snapshot?.revision} base={base} title="My published materials" />
      </PanelBody>
    </Panel>
  );
}
