import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { LIVE_ON_SCREEN_LIST_POLICY } from "../../../../../../../shared/live-on-screen-lists";
import { formatNumber } from "../../../../../../../shared/format-number";
import {
  DEFAULT_LIVE_CHAT_FEED_CONFIG,
  DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
  liveChatFeedConfigSchema,
  liveTopQuestionsConfigSchema,
  type LiveChatFeedConfig,
  type LiveTopQuestionsConfig,
} from "../../../../../../../shared/schemas/live-session-on-screen";
import { useContractForm, type ContractForm, type FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LIVE_SETTINGS_FOR_EVENT, useLiveGraphicSettings, type LiveStudioGraphicFor } from "./live-graphic-settings";
import type { LiveLayer, LiveTargets } from "./live-output-targets";

const range = ({ min, max }: { min: number; max: number }) =>
  Array.from({ length: max - min + 1 }, (_, index) => min + index);

/** A delay as the settings name it. */
function delayLabel(seconds: number): string {
  if (seconds === 0) return "No delay";
  return seconds % 60 === 0 ? `${formatNumber(seconds / 60)} min` : `${formatNumber(seconds)} s`;
}

/**
 * An audience list's row: its settings, and where it goes. The room fills
 * the list from what its moderation lets the audience see and keeps it
 * current, so the operator chooses only how it shows. The row follows the
 * list an output shows, and saving its settings changes it there.
 */
function AudienceListRow<Config extends { count: number }>({
  targets,
  name,
  subject,
  schema,
  shown,
  initial,
  detail,
  layer,
  fields,
  graphic,
}: {
  targets: LiveTargets;
  name: string;
  subject: string;
  schema: z.ZodType<Config>;
  /** The settings Preview shows the list with, else Program; null while it is off both. */
  shown: Config | null;
  initial: Config;
  detail: (config: Config) => string;
  layer: (config: Config) => LiveLayer;
  fields: (draft: Config, change: (patch: Partial<Config>) => void, form: ContractForm<Config>) => ComponentChildren;
  /** The list's entry in the event's setup. */
  graphic: LiveStudioGraphicFor<Config>;
}) {
  const { settings: config, save, saves } = useLiveGraphicSettings(targets, shown, initial, layer, graphic);
  const [draft, setDraft] = useState(config);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(schema, draft);
  return (
    <LiveGraphicRow
      name={name}
      detail={detail(config)}
      outputs={{ targets, subject, layer: layer(config) }}
      settings={{
        label: `${name} settings`,
        disabled: targets.disabled,
        onOpen: () => {
          setDraft(config);
          setError(null);
          setOpen(true);
        },
      }}
    >
      {open && (
        <Dialog
          open
          title={name}
          description={saves ? LIVE_SETTINGS_FOR_EVENT : undefined}
          confirmLabel="Save"
          onConfirm={() => {
            const checked = form.submit();
            if (!checked.data) return;
            void save(checked.data).then((problem) => {
              setError(problem);
              if (!problem) setOpen(false);
            });
          }}
          onCancel={() => setOpen(false)}
        >
          <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => event.preventDefault()}>
            {fields(draft, (patch) => setDraft((previous) => ({ ...previous, ...patch })), form)}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </form>
        </Dialog>
      )}
    </LiveGraphicRow>
  );
}

/** A number picked from a short list. */
function NumberSelect({
  label,
  name,
  value,
  choices,
  presentation,
  format = formatNumber,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  choices: readonly number[];
  presentation: FieldPresentation;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} {...presentation}>
      {(control) => (
        <Select
          {...control}
          name={name}
          value={String(value)}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {format(choice)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function LiveTopQuestionsControls({ targets }: { targets: LiveTargets }) {
  const shown = targets.state.preview.topQuestions ?? (targets.programActive ? targets.state.stage.topQuestions : null);
  return (
    <AudienceListRow<LiveTopQuestionsConfig>
      targets={targets}
      name="Top questions"
      subject="top questions"
      schema={liveTopQuestionsConfigSchema}
      shown={shown?.config ?? null}
      initial={DEFAULT_LIVE_TOP_QUESTIONS_CONFIG}
      graphic="topQuestions"
      detail={({ count }) => `${formatNumber(count)} open, most votes first`}
      layer={(config) => ({ kind: "topQuestions", config })}
      fields={(draft, change, form) => (
        <NumberSelect
          label="Questions to show"
          name="count"
          value={draft.count}
          choices={range(LIVE_ON_SCREEN_LIST_POLICY.questions)}
          presentation={form.of("count")}
          onChange={(count) => change({ count })}
        />
      )}
    />
  );
}

export function LiveChatFeedControls({ targets }: { targets: LiveTargets }) {
  const shown = targets.state.preview.chatFeed ?? (targets.programActive ? targets.state.stage.chatFeed : null);
  return (
    <AudienceListRow<LiveChatFeedConfig>
      targets={targets}
      name="Chat"
      subject="chat"
      schema={liveChatFeedConfigSchema}
      shown={shown?.config ?? null}
      initial={DEFAULT_LIVE_CHAT_FEED_CONFIG}
      graphic="chatFeed"
      detail={({ count, delaySeconds }) =>
        `Latest ${formatNumber(count)} messages · ${delaySeconds ? `${delayLabel(delaySeconds)} delay` : "no delay"}`
      }
      layer={(config) => ({ kind: "chatFeed", config })}
      fields={(draft, change, form) => (
        <>
          <NumberSelect
            label="Messages to show"
            name="count"
            value={draft.count}
            choices={range(LIVE_ON_SCREEN_LIST_POLICY.chat)}
            presentation={form.of("count")}
            onChange={(count) => change({ count })}
          />
          <NumberSelect
            label="Wait before a message shows"
            name="delaySeconds"
            value={draft.delaySeconds}
            choices={LIVE_ON_SCREEN_LIST_POLICY.chatDelaySeconds.choices}
            presentation={form.of("delaySeconds")}
            format={delayLabel}
            onChange={(delaySeconds) => change({ delaySeconds })}
          />
          <p class="pk-small pk-muted">
            Moderators can hide a message before it is on screen. The livestream often runs this far behind anyway.
          </p>
        </>
      )}
    />
  );
}

/** Viewers' reactions floating up over an output; nothing to set, only where they show. */
export function LiveReactionsControls({ targets }: { targets: LiveTargets }) {
  return (
    <LiveGraphicRow
      name="Reactions"
      detail="Viewer reactions float up the side"
      outputs={{ targets, subject: "reactions", layer: { kind: "reactions" } }}
    />
  );
}
