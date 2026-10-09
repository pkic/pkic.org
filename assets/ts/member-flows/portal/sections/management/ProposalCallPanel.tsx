/**
 * The state of an event's call for proposals, at the top of its Proposals tab:
 * whether it is open, when it opens and closes in the event's zone, and — for
 * someone who may change it — the actions to change the dates, close it now or
 * reopen it.
 *
 * It reads and writes the same form placement and submission window as the
 * Settings panel (`useEventFormPlacement`, `useEventSubmissionWindow`); this
 * is the place an organizer looks first, not a second implementation.
 */
import { useEffect, useState } from "preact/hooks";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Alert } from "../../../../ui/Alert";
import { Badge, type BadgeTone } from "../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../ui/Button";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { toast } from "../../ui";
import { patchSubmissionWindow, type PlacementResponse } from "./EventSubmissionWindow";
import { ProposalCallDatesDialog } from "./ProposalCallDatesDialog";
import { proposalCallState, type ProposalCallState } from "./proposal-call-state";
import { canConfigureEventForms, useEventFormPlacement } from "./useEventFormPlacement";

const STATUS_BADGES: Record<ProposalCallState["status"], { tone: BadgeTone; label: string }> = {
  open: { tone: "ok", label: "Open" },
  closed: { tone: "neutral", label: "Closed" },
  not_set_up: { tone: "warn", label: "Not set up" },
};

const WEBSITE_DEFINED_REASON =
  "This event's call for proposals is defined in the website content, so it can't be changed here yet.";

export function ProposalCallPanel({
  event,
  groupId,
  settingsHref,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  /** Where the proposal form is chosen: the event's Settings tab. */
  settingsHref: string;
  onUpdated?: () => void | Promise<void>;
}) {
  // The placement is readable by event managers only, and written only for an
  // event the portal owns; anyone else sees the server's verdict.
  const canRead = event.capabilities.includes("manage") && canConfigureEventForms(event);
  const canChange = canRead;
  const loaded = useEventFormPlacement(groupId, event.id, "proposal_submission", canRead);
  const { placement, setPlacement } = loaded;
  const [revision, setRevision] = useState(event.updatedAt);
  useEffect(() => setRevision(event.updatedAt), [event.id, event.updatedAt]);
  const [changingDates, setChangingDates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (canRead && loaded.loading && !placement) return <Spinner />;
  if (canRead && !placement)
    return <ErrorAlert error={loaded.error ?? "The call for proposals could not be loaded."} />;

  const attached = canRead ? (placement?.form?.placement ?? null) : undefined;
  const state = proposalCallState({
    placement: attached,
    call: event.proposalCall,
    endsAt: event.endsAt,
    timeZone: event.timezone,
    now: new Date(),
  });
  const badge = STATUS_BADGES[state.status];
  const base = loaded.base;

  async function saved(response: PlacementResponse): Promise<void> {
    setPlacement(response);
    setRevision(response.eventUpdatedAt);
    await onUpdated?.();
  }

  /** Close now and Reopen: the same PATCH as the dates dialog, with the window's other end left as it is. */
  async function moveWindow(closesAt: string | null, done: string): Promise<void> {
    if (!attached || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saved(
        await patchSubmissionWindow(base, { expectedUpdatedAt: revision, opensAt: attached.opensAt, closesAt }),
      );
      toast(done, "success");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeNow(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Close the call for proposals?",
      body: "Speakers will no longer be able to submit proposals.",
      consequences: ["Proposals already submitted are kept.", "You can reopen the call from this page."],
      confirmLabel: "Close now",
      tone: "danger",
    });
    if (confirmed) await moveWindow(new Date().toISOString(), "Call for proposals closed");
  }

  async function reopen(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Reopen the call for proposals?",
      body: "Speakers will be able to submit proposals again.",
      consequences: ["The closing date is cleared. Change the dates to set a new one."],
      confirmLabel: "Reopen",
      tone: "primary",
    });
    if (confirmed) await moveWindow(null, "Call for proposals reopened");
  }

  const items: DescriptionListItem[] = [{ term: "Status", value: <Badge tone={badge.tone}>{badge.label}</Badge> }];
  if (state.status !== "open") items.push({ term: "Why", value: state.reason });
  if (attached) {
    items.push(
      {
        term: "Opens",
        value: attached.opensAt ? formatDateTimeInZone(attached.opensAt, event.timezone) : "No opening restriction",
      },
      {
        term: "Closes",
        value: attached.closesAt ? formatDateTimeInZone(attached.closesAt, event.timezone) : "No closing restriction",
      },
    );
  }
  if (state.status === "open" && state.path) {
    items.push({ term: "Submission page", value: <a href={state.path}>Open the submission page</a> });
  }

  return (
    <Panel aria-label="Call for proposals">
      <PanelHeader title="Call for proposals">
        {canChange && attached && (
          <>
            {state.status === "open" && (
              <Button size="sm" disabled={busy} onClick={() => void closeNow()}>
                Close now
              </Button>
            )}
            {state.status === "closed" && state.reopenable && (
              <Button size="sm" disabled={busy} onClick={() => void reopen()}>
                Reopen
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => setChangingDates(true)}>
              Change dates
            </Button>
          </>
        )}
      </PanelHeader>
      <PanelBody class="pk-stack">
        <DescriptionList items={items} />
        {state.status === "not_set_up" && canChange && (
          <div class="pk-cluster">
            <ButtonLink href={settingsHref}>Choose a proposal form</ButtonLink>
          </div>
        )}
        {!canConfigureEventForms(event) && <p class="pk-small">{WEBSITE_DEFINED_REASON}</p>}
        {error && <Alert tone="danger">{error}</Alert>}
      </PanelBody>
      {changingDates && attached && (
        <ProposalCallDatesDialog
          base={base}
          placement={attached}
          expectedUpdatedAt={revision}
          timeZone={event.timezone}
          onSaved={(response) => {
            void saved(response);
            toast("Call for proposals dates saved", "success");
          }}
          onClose={() => setChangingDates(false)}
        />
      )}
    </Panel>
  );
}
