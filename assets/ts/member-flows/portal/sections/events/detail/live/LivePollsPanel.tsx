import { useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { StudioCreateAction } from "./studio/StudioCreateAction";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  DEFAULT_LIVE_POLL_PRESENTATION,
  type LivePoll,
  type LivePollPresentation,
} from "../../../../../../../shared/schemas/live-session-poll";
import type { LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { Button } from "../../../../../../ui/Button";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import { LiveLayerTargets } from "./LiveLayerTargets";
import { LivePollDialog, livePollWritten } from "./LivePollDialog";
import { LivePollEditor } from "./LivePollEditor";
import { LivePollStatusBadge } from "./LivePollStatusBadge";
import type { LiveTargets } from "./live-output-targets";
import { takeLiveStage } from "./live-stage-preview";
import "./LivePollsPanel.css";

type Send = (message: LiveRoomClientMessage) => boolean;

function rowMenu(poll: LivePoll, send: Send, onOpen: () => void): MenuItem[] {
  const status = (next: "open" | "closed") => () => send({ type: "poll.status", pollId: poll.id, status: next });
  const items: MenuItem[] = [
    { id: "details", label: "Results and settings", onSelect: onOpen },
    poll.status === "open"
      ? { id: "close", label: "Close voting", onSelect: status("closed") }
      : { id: "open", label: poll.status === "draft" ? "Open voting" : "Reopen voting", onSelect: status("open") },
  ];
  if (poll.status === "draft")
    items.push({
      id: "delete",
      label: "Delete poll",
      danger: true,
      separatorBefore: true,
      onSelect: async () => {
        const confirmed = await confirmAction({
          title: "Delete this poll?",
          body: `“${poll.field.label}” is removed for every operator.`,
          confirmLabel: "Delete poll",
          tone: "danger",
        });
        if (confirmed) send({ type: "poll.delete", pollId: poll.id });
      },
    });
  return items;
}

/** The leading answer and its share, "Yes · 62%", as the running tallies have it; nothing before any answer. */
function leading(poll: LivePoll): string | null {
  const results = poll.results;
  if (!results || results.totalAnswers === 0 || livePollWritten(poll)) return null;
  const top = [...results.entries].sort((left, right) => right.count - left.count)[0];
  if (!top) return null;
  return `${top.label} · ${formatNumber(Math.round((top.count / results.totalAnswers) * 100))}%`;
}

/** One poll as one compact row: its question, where it stands, its live results in brief, outputs and menu. */
function LivePollRow({
  poll,
  targets,
  send,
  presentation,
  onOpen,
}: {
  poll: LivePoll;
  targets: LiveTargets;
  send: Send;
  presentation: LivePollPresentation;
  onOpen: () => void;
}) {
  const { disabled } = targets;
  const answers = poll.results?.totalAnswers ?? 0;
  const top = leading(poll);
  return (
    <li class="pk-live-polls__row">
      <button
        type="button"
        class="pk-live-polls__open"
        title={`${poll.field.label}: results, edit and settings`}
        onClick={onOpen}
      >
        <span class="pk-live-polls__question">{poll.field.label}</span>
        <span class="pk-live-polls__summary">
          <LivePollStatusBadge status={poll.status} />
          <span class="pk-live-polls__count">
            {formatNumber(answers)} {answers === 1 ? "answer" : "answers"}
            {top ? ` · ${top}` : ""}
          </span>
        </span>
      </button>
      <span class="pk-live-polls__outputs">
        {poll.status === "draft" ? (
          <Button disabled={disabled} onClick={() => send({ type: "poll.status", pollId: poll.id, status: "open" })}>
            Open voting
          </Button>
        ) : (
          <LiveLayerTargets
            targets={targets}
            subject="poll results"
            layer={{ kind: "poll", id: poll.id, presentation }}
          />
        )}
      </span>
      <Menu
        label={`Poll actions, ${poll.field.label}`}
        items={disabled ? [] : rowMenu(poll, send, onOpen)}
        align="end"
      />
    </li>
  );
}

/** The polls panel's create action, in the studio panel's header: the "+" that prepares a new poll. */
export function LivePollsCreateAction({ disabled, send }: { disabled: boolean; send: Send }) {
  return (
    <StudioCreateAction label="New poll" disabled={disabled}>
      {(close) => (
        <LivePollEditor onSave={(draft) => send({ type: "poll.save", pollId: null, draft })} onClose={close} />
      )}
    </StudioCreateAction>
  );
}

/**
 * The session's polls, one compact row each, so many polls fit: prepare
 * them ahead, open one at a time and put the results on any output. A row
 * opens the poll in full — its live results, its question to correct, and
 * how its results are drawn — while the full broadcast picture stays on
 * Preview, where it belongs.
 */
export function LivePollsPanel({ targets, send }: { targets: LiveTargets; send: Send }) {
  const { state } = targets;
  // The open poll follows the address, like any detail view: a bookmark, refresh or Back keeps it.
  const [opened, setOpened] = useHashQueryParam("poll", "");
  const open = opened || null;
  const setOpen = (id: string | null) => setOpened(id ?? "");
  const [chosen, setChosen] = useState<Readonly<Record<string, LivePollPresentation>>>({});
  const presentationOf = (poll: LivePoll): LivePollPresentation => {
    const onStage = state.stage.poll?.id === poll.id ? state.stage.poll : null;
    return (
      onStage?.presentation ??
      chosen[poll.id] ??
      (livePollWritten(poll)
        ? { ...DEFAULT_LIVE_POLL_PRESENTATION, chart: "wordcloud" }
        : DEFAULT_LIVE_POLL_PRESENTATION)
    );
  };
  // The poll as the room has it now, so its results follow the answers while it is open.
  const current = open === null ? null : (state.polls.find((poll) => poll.id === open) ?? null);
  return (
    <div class="pk-live-polls">
      {state.polls.length ? (
        <ol class="pk-live-polls__list">
          {state.polls.map((poll) => (
            <LivePollRow
              key={poll.id}
              poll={poll}
              targets={targets}
              send={send}
              presentation={presentationOf(poll)}
              onOpen={() => setOpen(poll.id)}
            />
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No polls yet"
          body="Prepare a poll with New poll and open voting when the session is ready."
        />
      )}
      {current ? (
        <LivePollDialog
          poll={current}
          send={send}
          disabled={targets.disabled}
          presentation={presentationOf(current)}
          onAir={state.stage.poll?.id === current.id}
          onPresentation={(next) => {
            setChosen((all) => ({ ...all, [current.id]: next }));
            // A poll on Program changes its chart on air at once.
            if (state.stage.poll?.id === current.id)
              send({ ...takeLiveStage(state.stage), pollId: current.id, pollPresentation: next });
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
