import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, patchJson } from "../../../../../shared/api-client";
import {
  sponsorshipResponseSchema,
  SPONSORSHIP_PIPELINE_STAGES,
} from "../../../../../../shared/schemas/sponsorship-management";
import { fmt, fmtDate, toast } from "../../../ui";
import type {
  Sponsorship,
  SponsorshipEvent,
  SponsorshipPipelineStage,
} from "../../../../../../shared/schemas/sponsorship-management";
import { Badge, statusLabel } from "../../../../../components/Badge";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Field } from "../../../../../ui/Field";
import { DescriptionList, type DescriptionListItem } from "../../../../../ui/DescriptionList";
import { PageHeader } from "../../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { usePortalHashLocation } from "../../../hash-location";
import { Select, TextInput, Textarea } from "../../../../../ui/TextControl";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { useSponsorshipEventHistory } from "./useSponsorshipEventHistory";

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
  const [notes, setNotes] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<PickedUser | null>(null);
  const [nextStage, setNextStage] = useState<SponsorshipPipelineStage>("contacted");
  const [stageNote, setStageNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const detailRequestIdRef = useRef(0);
  const history = useSponsorshipEventHistory(id);

  const load = useCallback(async () => {
    const requestId = ++detailRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const detailData = await getJson(`/api/v1/sponsors/${encodeURIComponent(id)}`, sponsorshipResponseSchema);
      if (requestId !== detailRequestIdRef.current) return;
      setSponsorship(detailData.sponsorship);
      setNotes(detailData.sponsorship.notes ?? "");
      setRenewalDate(detailData.sponsorship.renewalDate ?? "");
      setAssignedTo(
        detailData.sponsorship.assignedToUserId
          ? {
              id: detailData.sponsorship.assignedToUserId,
              email: detailData.sponsorship.assignedToName ?? detailData.sponsorship.assignedToUserId,
            }
          : null,
      );
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

  async function saveFields() {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(id)}`,
        {
          notes: notes.trim() || null,
          renewalDate: renewalDate.trim() || null,
          assignedToUserId: assignedTo?.id ?? null,
        },
        sponsorshipResponseSchema,
      );
      toast("Saved", "success");
      setEditing(false);
      await load();
      onChanged?.();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage() {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(id)}/stage`,
        { toStage: nextStage, note: stageNote.trim() || null },
        sponsorshipResponseSchema,
      );
      toast(`Stage advanced to ${statusLabel(nextStage)}`, "success");
      setStageNote("");
      setAdvancing(false);
      await Promise.all([load(), history.reload()]);
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
    { term: "Assigned staff", value: sponsorship.assignedToName },
    { term: "Renewal date", value: sponsorship.renewalDate ? fmtDate(sponsorship.renewalDate) : null },
    { term: "Notes", value: sponsorship.notes },
  ];

  return (
    // The record page: the record and its facts take the width; the pipeline
    // — where it stands, how it got there, and the one command that moves it
    // — keeps the narrower column beside it. Every form here is closed until
    // asked for: a reader who opened a sponsorship to look at it is not
    // handed three forms to fill in.
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
              <form
                class="pk-stack pk-stack--snug"
                aria-label="Edit sponsorship record"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveFields();
                }}
              >
                <div class="pk-grid pk-grid--tight">
                  {/* A search-as-you-type picker: the record stores a user id,
                      but nobody types a UUID. A fieldset legend names it, the
                      way every composite picker is labelled, rather than a
                      label with no single control to point its `for` at. */}
                  <fieldset class="pk-fieldset pk-field">
                    <legend class="pk-field__label">Assigned staff</legend>
                    <UserPicker
                      endpoint="/api/v1/permissions/subjects"
                      value={assignedTo}
                      disabled={busy}
                      onChange={setAssignedTo}
                    />
                  </fieldset>
                  <Field label="Renewal date">
                    {(control) => (
                      <TextInput
                        {...control}
                        type="date"
                        value={renewalDate}
                        disabled={busy}
                        onInput={(e) => setRenewalDate((e.target as HTMLInputElement).value)}
                      />
                    )}
                  </Field>
                </div>
                <Field label="Notes">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      value={notes}
                      disabled={busy}
                      onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
                    />
                  )}
                </Field>
                <div class="pk-cluster">
                  <Button type="submit" variant="primary" size="sm" loading={busy}>
                    Save
                  </Button>
                </div>
              </form>
            )}
            {canWrite && !sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}
          </PanelBody>
        </Panel>

        <Panel aria-label="Pipeline">
          <PanelHeader title="Pipeline">
            {canWrite && (
              <Button size="sm" onClick={() => setAdvancing((current) => !current)} aria-expanded={advancing}>
                {advancing ? "Cancel" : "Advance stage"}
              </Button>
            )}
          </PanelHeader>
          <PanelBody class="pk-stack">
            {canWrite && advancing && (
              <form
                class="pk-stack pk-stack--snug"
                aria-label="Advance pipeline stage"
                onSubmit={(event) => {
                  event.preventDefault();
                  void advanceStage();
                }}
              >
                <Field label="Advance to stage">
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
                    Advance
                  </Button>
                </div>
              </form>
            )}

            <section
              class="pk-stack pk-stack--snug"
              aria-labelledby={`sponsorship-history-heading-${id}`}
              aria-busy={history.loading || history.loadingMore}
            >
              <h4 id={`sponsorship-history-heading-${id}`} class="pk-small pk-strong">
                History
              </h4>
              <div class="pk-sr-only" aria-live="polite">
                {history.announcement}
              </div>
              {history.loading && <Spinner />}
              {history.error && (
                <Alert tone="danger">
                  {history.error}{" "}
                  <Button variant="link" size="sm" onClick={history.retry}>
                    Retry history
                  </Button>
                </Alert>
              )}
              {!history.loading && history.events.length === 0 && !history.error && (
                <EmptyState title="No pipeline history has been recorded." />
              )}
              <ol id={`sponsorship-history-${id}`} class="pk-stack pk-stack--tight pk-small">
                {history.events.map((ev: SponsorshipEvent) => (
                  <li key={ev.id}>
                    <time class="pk-muted" dateTime={ev.createdAt}>
                      {fmt(ev.createdAt)}
                    </time>{" "}
                    — {ev.fromStage ? `${statusLabel(ev.fromStage)} → ` : ""}
                    <strong>{statusLabel(ev.toStage)}</strong>
                    {ev.actorName && <span class="pk-muted"> by {ev.actorName}</span>}
                    {ev.note && (
                      <div class="pk-muted">
                        <em>{ev.note}</em>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {history.page?.hasMore && !history.error && (
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    aria-controls={`sponsorship-history-${id}`}
                    loading={history.loadingMore}
                    onClick={history.loadMore}
                  >
                    {history.loadingMore ? "Loading…" : "Load older history"}
                  </Button>
                </div>
              )}
            </section>
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}
