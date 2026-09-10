import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, patchJson } from "../../../../../shared/api-client";
import {
  sponsorshipResponseSchema,
  SPONSORSHIP_PIPELINE_STAGES,
} from "../../../../../../shared/schemas/sponsorship-management";
import { fmtDate, toast } from "../../../ui";
import type { Sponsorship, SponsorshipPipelineStage } from "../../../../../../shared/schemas/sponsorship-management";
import type { ApiTableActions } from "../../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../../components/Badge";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { DescriptionList, type DescriptionListItem } from "../../../../../ui/DescriptionList";
import { PageHeader } from "../../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { usePortalHashLocation } from "../../../hash-location";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { SponsorshipHistory } from "./SponsorshipHistory";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { SponsorshipRecordForm } from "./SponsorshipRecordForm";

/** What the sponsorship is called, falling through the names it may carry. */
function sponsorTitle(sponsorship: Sponsorship): string {
  return sponsorship.organizationName ?? sponsorship.nonMemberName ?? sponsorship.contactName ?? "Sponsor";
}

export function SponsorshipDetail({
  id,
  canWrite,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextStage, setNextStage] = useState<SponsorshipPipelineStage>("contacted");
  const [stageNote, setStageNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const detailRequestIdRef = useRef(0);
  const historyRef = useRef<ApiTableActions | null>(null);

  const load = useCallback(async () => {
    const requestId = ++detailRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const detailData = await getJson(`/api/v1/sponsors/${encodeURIComponent(id)}`, sponsorshipResponseSchema);
      if (requestId !== detailRequestIdRef.current) return;
      setSponsorship(detailData.sponsorship);
    } catch (e) {
      if (requestId === detailRequestIdRef.current) setError((e as Error).message);
    } finally {
      if (requestId === detailRequestIdRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      detailRequestIdRef.current += 1;
    };
  }, [load]);

  async function moveStage() {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(id)}/stage`,
        { toStage: nextStage, note: stageNote.trim() || null },
        sponsorshipResponseSchema,
      );
      toast(`Stage moved to ${statusLabel(nextStage)}`, "success");
      setStageNote("");
      setAdvancing(false);
      // The move just wrote a history row, so the trail is asked for again
      // rather than being left one transition behind the badge above it.
      await Promise.all([load(), historyRef.current?.reload() ?? Promise.resolve()]);
      onChanged?.();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!sponsorship) return null;

  const title = sponsorTitle(sponsorship);
  const facts: DescriptionListItem[] = [
    { term: "Type", value: `${statusLabel(sponsorship.sponsorType)} sponsorship` },
    { term: "Tier", value: sponsorship.tier },
    { term: "Event", value: sponsorship.eventName },
    {
      term: "Contact",
      value: sponsorship.contactEmail
        ? `${sponsorship.contactName ?? sponsorship.contactEmail} <${sponsorship.contactEmail}>`
        : null,
    },
    {
      term: "Website",
      // Printed as plain text, so staff had to select and paste an address
      // that was already a destination. Same class as issue #13: a link that
      // is not presented as one.
      value: sponsorship.nonMemberWebsite ? (
        <a class="pk-break" href={sponsorship.nonMemberWebsite} target="_blank" rel="noopener noreferrer">
          {sponsorship.nonMemberWebsite.replace(/^https?:\/\//, "")}
        </a>
      ) : null,
    },
    { term: "Assigned staff", value: sponsorship.assignedToName },
    { term: "Renewal date", value: sponsorship.renewalDate ? fmtDate(sponsorship.renewalDate) : null },
    { term: "Notes", value: sponsorship.notes },
  ];

  return (
    // The record page: the record and its facts take the width; the pipeline
    // — where it stands and the one command that moves it — keeps the narrower
    // column beside it, and how it got there is the table below both. Every
    // form here is closed until asked for: a reader who opened a sponsorship
    // to look at it is not handed three forms to fill in.
    <section class="pk pk-stack" aria-label={title}>
      <PageHeader
        trail={[{ label: "Sponsors", href: usePortalHashLocation.hrefs("/sponsors") }, { label: title }]}
        title={title}
        context={<Badge status={sponsorship.pipelineStage} />}
      />
      <div class="pk-record">
        <Panel aria-label="Sponsorship record">
          <PanelHeader title="Record">
            {canWrite && (
              <Button size="sm" onClick={() => setEditing((current) => !current)} aria-expanded={editing}>
                {editing ? "Cancel" : "Edit"}
              </Button>
            )}
          </PanelHeader>
          <PanelBody class="pk-stack">
            {!editing && <DescriptionList items={facts} density="compact" />}
            {canWrite && editing && (
              <SponsorshipRecordForm
                sponsorship={sponsorship}
                onSaved={async () => {
                  setEditing(false);
                  await load();
                  onChanged?.();
                }}
              />
            )}
            {canWrite && !sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}
          </PanelBody>
        </Panel>

        <Panel aria-label="Pipeline">
          <PanelHeader title="Pipeline">
            {canWrite && (
              <Button size="sm" onClick={() => setAdvancing((current) => !current)} aria-expanded={advancing}>
                {advancing ? "Cancel" : "Move stage"}
              </Button>
            )}
          </PanelHeader>
          <PanelBody class="pk-stack">
            {canWrite && advancing && (
              <form
                class="pk-stack pk-stack--snug"
                aria-label="Move pipeline stage"
                onSubmit={(event) => {
                  event.preventDefault();
                  void moveStage();
                }}
              >
                <Field label="Move to stage">
                  {(control) => (
                    <Select
                      {...control}
                      value={nextStage}
                      disabled={busy}
                      onChange={(e) => setNextStage((e.target as HTMLSelectElement).value as SponsorshipPipelineStage)}
                    >
                      {SPONSORSHIP_PIPELINE_STAGES.map((s) => (
                        <option value={s} key={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Note (optional)">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={stageNote}
                      disabled={busy}
                      onInput={(e) => setStageNote((e.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <div class="pk-cluster">
                  <Button type="submit" variant="primary" size="sm" loading={busy}>
                    Move
                  </Button>
                </div>
              </form>
            )}
            <p class="pk-small pk-muted">Every stage this sponsorship has passed through is listed below the record.</p>
          </PanelBody>
        </Panel>
      </div>

      {/* The trail is a table of four columns, so it takes the page's width
          rather than the narrow column the pipeline panel keeps beside the
          record — where a note wraps to one word per line. */}
      <SponsorshipHistory sponsorshipId={id} actionsRef={historyRef} />
    </section>
  );
}
