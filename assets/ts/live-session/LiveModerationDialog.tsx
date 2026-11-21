/**
 * The Hide and Block dialogs of a live session room: one question, why,
 * answered from the shared moderation reasons, and for a block whether the
 * person's posts in this session go too.
 *
 * Promise-based like `confirmAction`: call `askModerationReason()` from a
 * menu item; every surface that offers moderation mounts the host, and the
 * first host to render a request claims it.
 */
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { LIVE_MODERATION_REASONS, type LiveModerationReason } from "../../shared/live-moderation-policy";
import { liveModerationReasonFormSchema } from "../../shared/schemas/live-session-moderation";
import { useContractForm } from "../hooks/useContractForm";
import { Checkbox, Radio } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

export interface LiveModerationRequest {
  title: string;
  /** One sentence on what happens. */
  body: string;
  /** Names the action, e.g. "Hide message". */
  confirmLabel: string;
  /** Offers "Also hide their posts in this session", on by default. */
  offerRemovePosts?: boolean;
}

export interface LiveModerationDecision {
  reason: LiveModerationReason;
  removePosts: boolean;
}

interface ActiveRequest extends LiveModerationRequest {
  resolve: (decision: LiveModerationDecision | null) => void;
  host?: symbol;
}

const active = signal<ActiveRequest | null>(null);

/** Asks why; resolves null when the moderator backs out. */
export function askModerationReason(request: LiveModerationRequest): Promise<LiveModerationDecision | null> {
  return new Promise((resolve) => {
    active.value?.resolve(null);
    active.value = { ...request, resolve };
  });
}

function settle(decision: LiveModerationDecision | null): void {
  const current = active.value;
  active.value = null;
  current?.resolve(decision);
}

export function LiveModerationDialogHost() {
  const [host] = useState(() => Symbol("live-moderation-dialog-host"));
  // A host that leaves the page backs out of the request it was showing.
  useEffect(
    () => () => {
      if (active.value?.host === host) settle(null);
    },
    [host],
  );
  const request = active.value;
  if (!request) return null;
  request.host ??= host;
  if (request.host !== host) return null;
  return <LiveModerationDialogBody request={request} />;
}

function LiveModerationDialogBody({ request }: { request: ActiveRequest }) {
  const [reason, setReason] = useState<LiveModerationReason | null>(null);
  const [removePosts, setRemovePosts] = useState(request.offerRemovePosts ?? false);
  const form = useContractForm(liveModerationReasonFormSchema, {
    reason: reason ?? undefined,
    removePosts: request.offerRemovePosts ? removePosts : false,
  });
  const reasonField = form.ofGroup("reason");
  return (
    <div class="pk">
      <Dialog
        open
        title={request.title}
        description={request.body}
        confirmLabel={request.confirmLabel}
        destructive
        onConfirm={() => {
          const checked = form.submit();
          if (checked.data) settle(checked.data);
        }}
        onCancel={() => settle(null)}
      >
        <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => event.preventDefault()}>
          <Field label="Reason" group required state={reasonField.state} message={reasonField.message}>
            {() => (
              <div class="pk-stack pk-stack--snug">
                {LIVE_MODERATION_REASONS.map((entry) => (
                  <Radio
                    key={entry.id}
                    name="reason"
                    value={entry.id}
                    checked={reason === entry.id}
                    onChange={() => setReason(entry.id)}
                    label={entry.label}
                  />
                ))}
              </div>
            )}
          </Field>
          {request.offerRemovePosts ? (
            <Checkbox
              name="removePosts"
              checked={removePosts}
              onChange={(event) => setRemovePosts(event.currentTarget.checked)}
              label="Also hide their posts in this session"
            />
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
