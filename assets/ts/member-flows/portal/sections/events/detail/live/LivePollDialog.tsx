import { useId } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  livePollPresentationSchema,
  type LivePoll,
  type LivePollPresentation,
} from "../../../../../../../shared/schemas/live-session-poll";
import type { LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { FormFieldStatChart } from "../../../../../../components/forms/FormResponseStats";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { TabList } from "../../../../../../ui/TabList";
import { Select } from "../../../../../../ui/TextControl";
import { useLivePollEditor } from "./LivePollEditor";
import { LivePollStatusBadge } from "./LivePollStatusBadge";

type Send = (message: LiveRoomClientMessage) => boolean;
type Chart = LivePollPresentation["chart"];

export const LIVE_POLL_CHART_LABELS: Record<Chart, string> = {
  bar: "Bars",
  donut: "Donut",
  pie: "Pie",
  wordcloud: "Word cloud",
};

/** Whether a poll collects written answers, which only a word cloud can draw. */
export function livePollWritten(poll: LivePoll): boolean {
  return poll.field.fieldType === "text" || poll.field.fieldType === "textarea";
}

/** The charts a poll's answers can be drawn as. */
export function livePollCharts(poll: LivePoll): Chart[] {
  return livePollWritten(poll) ? ["wordcloud"] : ["bar", "donut", "pie"];
}

const TABS = [
  { id: "results", label: "Results" },
  { id: "edit", label: "Edit" },
  { id: "settings", label: "Settings" },
] as const;
const TAB_IDS = TABS.map((item) => item.id);
type Tab = (typeof TABS)[number]["id"];

/** The results as they come in, with the voting control beside them. */
function ResultsTab({
  poll,
  presentation,
  send,
  disabled,
}: {
  poll: LivePoll;
  presentation: LivePollPresentation;
  send: Send;
  disabled: boolean;
}) {
  const answers = poll.results?.totalAnswers ?? 0;
  const status = (next: "open" | "closed") => send({ type: "poll.status", pollId: poll.id, status: next });
  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-live-poll-dialog__status">
        <LivePollStatusBadge status={poll.status} />
        <span>
          {formatNumber(answers)} {answers === 1 ? "answer" : "answers"}
        </span>
        {poll.status === "open" ? (
          <Button disabled={disabled} onClick={() => status("closed")}>
            Close voting
          </Button>
        ) : (
          <Button variant="primary" disabled={disabled} onClick={() => status("open")}>
            {poll.status === "draft" ? "Open voting" : "Reopen voting"}
          </Button>
        )}
      </div>
      {poll.results && answers > 0 ? (
        <FormFieldStatChart field={poll.field} stat={poll.results} visualization={presentation.chart} />
      ) : (
        <p class="pk-muted">
          {poll.status === "draft"
            ? "Results appear here as answers arrive, once voting opens."
            : "No answers yet. Results appear here as they arrive."}
        </p>
      )}
    </div>
  );
}

/** How the results graphic is drawn on air. */
function SettingsTab({
  poll,
  presentation,
  onPresentation,
  onAir,
  disabled,
}: {
  poll: LivePoll;
  presentation: LivePollPresentation;
  onPresentation: (next: LivePollPresentation) => void;
  onAir: boolean;
  disabled: boolean;
}) {
  const form = useContractForm(livePollPresentationSchema, presentation);
  const charts = livePollCharts(poll);
  return (
    <div class="pk-stack pk-stack--snug" {...form.handlers}>
      <Field
        label="Chart"
        help={
          onAir
            ? "These results are on air: a new chart shows there at once."
            : "Used the next time these results go on an output."
        }
        {...form.of("chart")}
      >
        {(control) => (
          <Select
            {...control}
            name="chart"
            value={presentation.chart}
            disabled={disabled || charts.length < 2}
            onChange={(event) => {
              const next = livePollPresentationSchema.shape.chart.safeParse(event.currentTarget.value);
              if (next.success) onPresentation({ ...presentation, chart: next.data });
            }}
          >
            {charts.map((chart) => (
              <option key={chart} value={chart}>
                {LIVE_POLL_CHART_LABELS[chart]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p class="pk-small pk-muted">
        {poll.showResults
          ? "Attendees see results after they answer and once voting closes. Change this under Edit."
          : "Results stay with the operators and the broadcast. Change this under Edit."}
      </p>
    </div>
  );
}

/**
 * One poll in full: its live results, its question and choices to correct,
 * and how its results are drawn. The dialog keeps one size across tabs; Save
 * applies only to Edit, and the other tabs act at once and say so.
 */
export function LivePollDialog({
  poll,
  send,
  disabled,
  presentation,
  onPresentation,
  onAir,
  onClose: close,
}: {
  poll: LivePoll;
  send: Send;
  disabled: boolean;
  presentation: LivePollPresentation;
  onPresentation: (next: LivePollPresentation) => void;
  onAir: boolean;
  onClose: () => void;
}) {
  // The tab follows the address with the open poll, so a refresh or Back returns to the same view.
  const [tab, setTab] = useHashQueryParam<Tab>("pollView", "results", TAB_IDS);
  const ids = useId();
  // Closing leaves no tab behind in the address for the next poll.
  const onClose = () => {
    setTab("results");
    close();
  };
  const editor = useLivePollEditor({
    poll,
    onSave: (draft, discardRemovedAnswers) =>
      send({
        type: "poll.save",
        pollId: poll.id,
        draft,
        ...(discardRemovedAnswers ? { discardRemovedAnswers } : {}),
      }),
    onSaved: onClose,
  });
  const panel = (id: Tab) => ({
    id: `${ids}-${id}`,
    role: "tabpanel" as const,
    "aria-labelledby": `${ids}-tab-${id}`,
    hidden: tab !== id,
  });
  return (
    <Dialog
      open
      size="wide"
      title={poll.field.label}
      kicker="Poll"
      confirmLabel={tab === "edit" ? "Save poll" : "Close"}
      cancelLabel={tab === "edit" ? "Cancel" : null}
      confirmDisabled={tab === "edit" && disabled}
      onConfirm={() => {
        if (tab !== "edit") return onClose();
        editor.save();
      }}
      onCancel={onClose}
    >
      <TabList
        label="Poll"
        idPrefix={`${ids}-tab`}
        activeId={tab}
        onSelect={(id) => setTab(id as Tab)}
        items={TABS.map((item) => ({ ...item, panelId: `${ids}-${item.id}` }))}
      />
      <div {...panel("results")}>
        <ResultsTab poll={poll} presentation={presentation} send={send} disabled={disabled} />
      </div>
      <div {...panel("edit")}>
        <p class="pk-small pk-muted">{editor.description}</p>
        {editor.body}
      </div>
      <div {...panel("settings")}>
        <SettingsTab
          poll={poll}
          presentation={presentation}
          onPresentation={onPresentation}
          onAir={onAir}
          disabled={disabled}
        />
      </div>
    </Dialog>
  );
}
