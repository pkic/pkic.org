import { useState } from "preact/hooks";
import { LIVE_ON_SCREEN_LIST_POLICY } from "../../../../../../../shared/live-on-screen-lists";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  DEFAULT_LIVE_CHAT_FEED_CONFIG,
  DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
  liveChatFeedConfigSchema,
  liveTopQuestionsConfigSchema,
} from "../../../../../../../shared/schemas/live-session-on-screen";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveLayerTargets } from "./LiveLayerTargets";
import type { LiveLayer, LiveTargets } from "./live-output-targets";

type ListKind = "topQuestions" | "chatFeed";

/** What each audience list is, as the Graphics panel names it. */
const LISTS = {
  topQuestions: {
    name: "Top questions",
    subject: "top questions",
    schema: liveTopQuestionsConfigSchema,
    fallback: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
    policy: LIVE_ON_SCREEN_LIST_POLICY.questions,
    countLabel: "Questions to show",
    detail: (count: number) => `${formatNumber(count)} open, most votes first`,
  },
  chatFeed: {
    name: "Chat",
    subject: "chat",
    schema: liveChatFeedConfigSchema,
    fallback: DEFAULT_LIVE_CHAT_FEED_CONFIG,
    policy: LIVE_ON_SCREEN_LIST_POLICY.chat,
    countLabel: "Messages to show",
    detail: (count: number) => `Latest ${formatNumber(count)} attendee messages`,
  },
} as const;

/**
 * An audience list's row: how many lines it shows, and where it goes. The
 * room fills the list from what its moderation lets the audience see and
 * keeps it current, so the operator chooses only the count.
 */
function LiveAudienceListControls({ targets, kind }: { targets: LiveTargets; kind: ListKind }) {
  const list = LISTS[kind];
  const shown = targets.state.preview[kind] ?? (targets.programActive ? targets.state.stage[kind] : null);
  const [count, setCount] = useState(shown?.config.count ?? list.fallback.count);
  const [draft, setDraft] = useState(count);
  const [open, setOpen] = useState(false);
  const form = useContractForm(list.schema, { count: draft });
  const choices = Array.from({ length: list.policy.max - list.policy.min + 1 }, (_, index) => list.policy.min + index);
  const layer: LiveLayer = { kind, config: { count } };
  return (
    <LiveGraphicRow
      name={list.name}
      detail={list.detail(count)}
      settings={{
        label: `${list.name} settings`,
        disabled: targets.disabled,
        onOpen: () => {
          setDraft(count);
          setOpen(true);
        },
      }}
    >
      <LiveLayerTargets targets={targets} subject={list.subject} layer={layer} />
      {open && (
        <Dialog
          open
          title={list.name}
          confirmLabel="Save"
          onConfirm={() => {
            const checked = form.submit();
            if (checked.data) {
              setCount(checked.data.count);
              setOpen(false);
            }
          }}
          onCancel={() => setOpen(false)}
        >
          <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => event.preventDefault()}>
            <Field label={list.countLabel} {...form.of("count")}>
              {(control) => (
                <Select
                  {...control}
                  name="count"
                  value={String(draft)}
                  onChange={(event) => setDraft(Number(event.currentTarget.value))}
                >
                  {choices.map((value) => (
                    <option key={value} value={value}>
                      {formatNumber(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </form>
        </Dialog>
      )}
    </LiveGraphicRow>
  );
}

export function LiveTopQuestionsControls({ targets }: { targets: LiveTargets }) {
  return <LiveAudienceListControls targets={targets} kind="topQuestions" />;
}

export function LiveChatFeedControls({ targets }: { targets: LiveTargets }) {
  return <LiveAudienceListControls targets={targets} kind="chatFeed" />;
}

/** Viewers' reactions floating up over an output; nothing to set, only where they show. */
export function LiveReactionsControls({ targets }: { targets: LiveTargets }) {
  return (
    <LiveGraphicRow name="Reactions" detail="Viewer reactions float up the side">
      <LiveLayerTargets targets={targets} subject="reactions" layer={{ kind: "reactions" }} />
    </LiveGraphicRow>
  );
}
