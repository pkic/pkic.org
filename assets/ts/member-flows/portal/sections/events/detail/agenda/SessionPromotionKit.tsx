import "./SessionPromotionKit.css";
import { useEffect, useState } from "preact/hooks";
import {
  promotionKitSaveSchema,
  promotionKitSchema,
  promotionFormatSchema,
} from "../../../../../../../shared/schemas/event-promotion-kit";
import {
  agendaSnapshotSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { getJson, postJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Textarea } from "../../../../../../ui/TextControl";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { z } from "zod";
type Kit = z.infer<typeof promotionKitSchema>;
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
  const [kit, setKit] = useState<Kit | null>(null);
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
      setKit(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save promotion copy.");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      setKit(await postJson(`${base}/renders`, {}, promotionKitSchema));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare promotion kit.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!kit || !kit.artifacts.some((artifact) => ["queued", "rendering", "retrying"].includes(artifact.status)))
      return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getJson(base, promotionKitSchema)
        .then((next) => {
          if (!cancelled) setKit(next);
        })
        .catch((failure) => {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not refresh render progress.");
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, kit]);
  return (
    <Panel>
      <PanelHeader title={`Promotion kit · ${occurrence.title}`}>
        <Button onClick={onClose}>Close</Button>
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
              help="One per line; two to five specific points."
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
        <Button onClick={load} disabled={busy}>
          Prepare published kit
        </Button>
        {error && <ErrorAlert error={error} />}{" "}
        {kit && (
          <section>
            <p>
              Approved agenda revision {kit.publishedRevision} · template {kit.templateVersion}. Times use the event
              timezone. Check the session page for current details.
            </p>
            <p>
              <a href={kit.sessionUrl}>Session page</a> ·{" "}
              <a href={kit.registrationUrl}>Event registration / promoter link</a>
            </p>
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(`${occurrence.title}\n${kit.copy.whyAttend}\n${kit.registrationUrl}`)
              }
            >
              Copy post and registration link
            </Button>
            <p>
              {kit.metrics.downloads} downloads · {kit.metrics.clicks} registration-link clicks ·{" "}
              {kit.metrics.confirmedRegistrations} confirmed referrals · {kit.metrics.sessionRsvps} session RSVPs.
              Registrations and RSVPs are separate from observed attendance.
            </p>
            <ul>
              {promotionFormatSchema.options.map((format) => (
                <li>
                  {kit.artifacts.some((artifact) => artifact.format === format && artifact.status === "rendered") ? (
                    <a href={`${base}/artifact?format=${format}&revision=${kit.publishedRevision}`} download>
                      {format === "carousel" ? "LinkedIn carousel PDF" : `${format} cards (PNG or ZIP)`}
                    </a>
                  ) : (
                    <span>
                      {format}: {kit.artifacts.find((artifact) => artifact.format === format)?.status ?? "not prepared"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p>
              Document uploads support up to 100 MB and 300 pages.{" "}
              <a href="https://www.linkedin.com/help/linkedin/answer/a518909" target="_blank" rel="noopener noreferrer">
                LinkedIn document guidance
              </a>
            </p>
            <p>
              Long titles and complete panel credits continue across additional cards, downloaded together as a ZIP.
            </p>
            {kit.artifacts.some((artifact) => artifact.format === "landscape" && artifact.status === "rendered") && (
              <img
                class="pk-promotion-kit__preview"
                src={`${base}/artifact?format=landscape&download=false&revision=${kit.publishedRevision}`}
                width="1200"
                height="630"
                alt={`First landscape promotion card for ${occurrence.title}`}
              />
            )}
          </section>
        )}
      </PanelBody>
    </Panel>
  );
}
