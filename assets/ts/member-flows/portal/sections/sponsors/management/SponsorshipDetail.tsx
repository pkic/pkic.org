import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, patchJson } from "../../../../../shared/api-client";
import {
  sponsorshipResponseSchema,
  SPONSORSHIP_PIPELINE_STAGES,
} from "../../../../../../shared/schemas/sponsorship-management";
import { fmt, toast } from "../../../ui";
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
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
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

  return (
    <div class="pk">
      <Panel aria-label={title}>
        <PanelHeader title={title} headingLevel={2}>
          <Badge status={sponsorship.pipelineStage} />
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-small">
            {statusLabel(sponsorship.sponsorType)} sponsorship · {sponsorship.tier ?? "No tier"}
            {sponsorship.eventName && <> · {sponsorship.eventName}</>}
          </p>

          {sponsorship.contactEmail && (
            <p class="pk-small">
              Contact: {sponsorship.contactName ?? sponsorship.contactEmail} &lt;{sponsorship.contactEmail}&gt;
            </p>
          )}

          {canWrite && !sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}

          {canWrite && (
            <fieldset class="pk-fieldset pk-field">
              <legend class="pk-field__label">Sponsorship record</legend>
              <div class="pk-stack pk-stack--snug">
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
                  <Button size="sm" loading={busy} onClick={() => void saveFields()}>
                    Save
                  </Button>
                </div>
              </div>
            </fieldset>
          )}

          {canWrite && (
            <fieldset class="pk-fieldset pk-field">
              <legend class="pk-field__label">Pipeline stage</legend>
              <div class="pk-stack pk-stack--snug">
                <div class="pk-grid pk-grid--tight">
                  <Field label="Advance to stage">
                    {(control) => (
                      <Select
                        {...control}
                        value={nextStage}
                        disabled={busy}
                        onChange={(e) =>
                          setNextStage((e.target as HTMLSelectElement).value as SponsorshipPipelineStage)
                        }
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
                </div>
                <div class="pk-cluster">
                  <Button variant="primary" size="sm" loading={busy} onClick={() => void advanceStage()}>
                    Advance
                  </Button>
                </div>
              </div>
            </fieldset>
          )}

          <section
            class="pk-stack pk-stack--snug"
            aria-labelledby={`sponsorship-history-heading-${id}`}
            aria-busy={history.loading || history.loadingMore}
          >
            <h3 id={`sponsorship-history-heading-${id}`} class="pk-small pk-strong">
              Pipeline history
            </h3>
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
  );
}
