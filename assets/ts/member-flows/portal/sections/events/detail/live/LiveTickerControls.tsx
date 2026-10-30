import { useRef, useState } from "preact/hooks";
import {
  liveTickerConfigSchema,
  liveTickerMessageSchema,
  DEFAULT_LIVE_TICKER_CONFIG,
  LIVE_TICKER_MESSAGES_MAX,
  type LiveTickerConfig,
  type LiveTickerContext,
} from "../../../../../../../shared/schemas/live-session-ticker";
import { LIVE_TICKER_TAGS } from "../../../../../../../shared/live-ticker-template";
import { overlayTextTemplateTags } from "../../../../../../../shared/overlay-text-template";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useContractForm, type FieldPresentation } from "../../../../../../hooks/useContractForm";
import { MarkdownEditor } from "../../../../../../components/markdown-editor/MarkdownInput";
import type { MarkdownEditorHandle } from "../../../../../../components/markdown-editor/MarkdownEditor";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { ListDetail } from "../../../../../../ui/ListDetail";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Alert } from "../../../../../../ui/Alert";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveLayerTargets } from "./LiveLayerTargets";
import type { LiveTargets } from "./live-output-targets";
import "./LiveTickerControls.css";

type Message = LiveTickerConfig["messages"][number];
const CONDITION_LABELS: Record<Message["condition"], string> = {
  always: "Always",
  "near-session-end": "Last five minutes of the session",
};
const STYLE_LABELS: Record<LiveTickerConfig["style"], string> = {
  gradient: "Brand gradient",
  accent: "Accent",
  neutral: "Neutral",
};

/** The selected message's fields: its fixed label, its words with the agenda's placeholders, and when it shows. */
function TickerMessageEditor({
  message,
  index,
  of,
  update,
  remove,
  canRemove,
  context,
}: {
  message: Message;
  index: number;
  of: (path: string) => FieldPresentation;
  update: (message: Message) => void;
  remove: () => void;
  canRemove: boolean;
  context: LiveTickerContext;
}) {
  const editor = useRef<MarkdownEditorHandle>(null),
    path = `messages.${index}`;
  const fromAgenda = overlayTextTemplateTags(message.template).length > 0;
  return (
    <>
      <div class="pk-live-ticker-editor__head">
        <strong>
          Message {formatNumber(index + 1)} · {fromAgenda ? "From the agenda" : "Custom"}
        </strong>
        <Button variant="danger-quiet" disabled={!canRemove} onClick={remove}>
          Remove message
        </Button>
      </div>
      <Field label="Message label" help="Scrolls with this message in the continuous ticker." {...of(`${path}.prefix`)}>
        {(control) => (
          <TextInput
            {...control}
            value={message.prefix}
            onInput={(event) => update({ ...message, prefix: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field label="Message" {...of(`${path}.template`)}>
        {(control) => (
          <MarkdownEditor
            {...control}
            key={message.id}
            name={`${path}.template`}
            label="Message"
            initialValue={message.template}
            variant="compact"
            initialMode="source"
            editorRef={editor}
            onChange={(template) => update({ ...message, template })}
            templateInsertions={[
              ...LIVE_TICKER_TAGS,
              ...context.sponsorGroups.map((group) => ({
                key: `sponsors.tier.${group.key}`,
                label: `${group.tier} sponsors`,
              })),
            ].map((tag) => ({
              id: tag.key,
              label: tag.label,
              onSelect: () => editor.current?.insertText(`{{${tag.key}}}`),
            }))}
          />
        )}
      </Field>
      <Field label="When to show" {...of(`${path}.condition`)}>
        {(control) => (
          <Select
            {...control}
            value={message.condition}
            onChange={(event) =>
              update({
                ...message,
                condition: event.currentTarget.value === "near-session-end" ? "near-session-end" : "always",
              })
            }
          >
            {liveTickerMessageSchema.shape.condition.options.map((condition) => (
              <option key={condition} value={condition}>
                {CONDITION_LABELS[condition]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

/** The next free message id: message-1, message-2, … */
function nextMessageId(messages: readonly Message[]): string {
  let next = 1;
  while (messages.some((message) => message.id === `message-${next}`)) next++;
  return `message-${next}`;
}

/**
 * The news ticker: a sequence of messages, from the agenda (other rooms,
 * what is next, sponsors) or written by the operator. The editor lists the
 * messages as compact rows in their order beside the selected one's fields,
 * so a long sequence stays easy to reorder and edit. Edits stay in the editor
 * until they validate, so every output gets a sequence the room accepts.
 */
export function LiveTickerControls({ targets }: { targets: LiveTargets }) {
  const context = targets.state.tickerContext;
  const [config, setConfig] = useState<LiveTickerConfig>(() => {
    const saved = targets.state.preview.ticker ?? targets.state.stage.ticker;
    return saved ? { style: saved.style, messages: saved.messages } : DEFAULT_LIVE_TICKER_CONFIG;
  });
  const [draft, setDraft] = useState<LiveTickerConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(liveTickerConfigSchema, draft ?? config);
  const fromAgenda = config.messages.filter((message) => overlayTextTemplateTags(message.template).length > 0).length;
  const edit = (update: (current: LiveTickerConfig) => LiveTickerConfig) =>
    setDraft((current) => (current ? update(current) : current));
  const index = draft
    ? Math.max(
        0,
        draft.messages.findIndex((message) => message.id === selected),
      )
    : 0;
  const current = draft?.messages[index];
  const problem = (at: number) =>
    ["prefix", "template", "condition"].map((field) => form.of(`messages.${at}.${field}`).message).find(Boolean);
  return (
    <LiveGraphicRow
      name="News ticker"
      detail={`${formatNumber(config.messages.length)} messages · ${formatNumber(fromAgenda)} from the agenda`}
      settings={{
        label: "Edit ticker messages",
        disabled: targets.disabled,
        onOpen: () => {
          setDraft(config);
          setSelected(config.messages[0]?.id ?? null);
          setError(null);
        },
      }}
    >
      <LiveLayerTargets targets={targets} subject="news ticker" layer={{ kind: "ticker", config }} />
      {draft ? (
        <Dialog
          open
          size="wide"
          title="News ticker"
          confirmLabel="Done"
          onConfirm={() => {
            const checked = form.submit();
            if (checked.data) {
              setConfig(checked.data);
              setDraft(null);
              setError(null);
            } else setError(checked.formMessage);
          }}
          onCancel={() => setDraft(null)}
        >
          <form
            class="pk-live-ticker-editor"
            noValidate
            {...form.handlers}
            onSubmit={(event) => event.preventDefault()}
          >
            <Field label="Style" {...form.of("style")}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.style}
                  onChange={(event) => {
                    const parsed = liveTickerConfigSchema.shape.style.safeParse(event.currentTarget.value);
                    if (parsed.success) edit((value) => ({ ...value, style: parsed.data }));
                  }}
                >
                  {liveTickerConfigSchema.shape.style.options.map((style) => (
                    <option key={style} value={style}>
                      {STYLE_LABELS[style]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <ListDetail
              listLabel="Ticker messages, in the order they scroll"
              selectedId={current?.id ?? null}
              onSelect={setSelected}
              onMove={(id, direction) =>
                edit((value) => {
                  const messages = [...value.messages];
                  const at = messages.findIndex((message) => message.id === id);
                  const to = at + direction;
                  if (at < 0 || to < 0 || to >= messages.length) return value;
                  [messages[at], messages[to]] = [messages[to]!, messages[at]!];
                  return { ...value, messages };
                })
              }
              items={draft.messages.map((message, at) => ({
                id: message.id,
                label: message.prefix.trim() || `Message ${formatNumber(at + 1)}`,
                detail: `${message.template} · ${CONDITION_LABELS[message.condition]}`,
                attention: problem(at),
              }))}
              addAction={
                <Button
                  disabled={draft.messages.length >= LIVE_TICKER_MESSAGES_MAX}
                  onClick={() => {
                    const id = nextMessageId(draft.messages);
                    edit((value) => ({
                      ...value,
                      messages: [...value.messages, { id, prefix: "", template: "{{greeting}}", condition: "always" }],
                    }));
                    setSelected(id);
                  }}
                >
                  Add message
                </Button>
              }
            >
              {current ? (
                <TickerMessageEditor
                  key={current.id}
                  message={current}
                  index={index}
                  canRemove={draft.messages.length > 1}
                  context={context}
                  of={form.of}
                  update={(next) =>
                    edit((value) => ({
                      ...value,
                      messages: value.messages.map((item) => (item.id === current.id ? next : item)),
                    }))
                  }
                  remove={() => {
                    const remaining = draft.messages.filter((item) => item.id !== current.id);
                    setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
                    edit((value) => ({ ...value, messages: value.messages.filter((item) => item.id !== current.id) }));
                  }}
                />
              ) : null}
            </ListDetail>
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </form>
        </Dialog>
      ) : null}
    </LiveGraphicRow>
  );
}
