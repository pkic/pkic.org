/**
 * Promise-based confirmation that replaces window.confirm portal-wide.
 *
 * A confirmation is a decision, so the dialog states consequences as a list
 * the reader can scan, names the action on the confirm button (never "OK"),
 * and for irreversible operations demands the target's name be typed back.
 *
 * Mount <ConfirmDialogHost /> once near the app root; call confirmAction()
 * anywhere. Cancel and Escape resolve false.
 *
 * The dialog itself is the design system's `Dialog`, which is a native
 * <dialog> opened with showModal(). That is not a cosmetic swap. The version
 * this replaces was a positioned <div> with `role="alertdialog"`, which meant
 * it looked modal and was not: focus could tab straight out of it into the
 * page behind, the rest of the document stayed reachable to a screen reader,
 * and Escape only worked because of a document-level key listener. The
 * platform gives all three away for free, correctly, and takes the focus
 * trap with it.
 *
 * One behaviour is deliberately gone: clicking the backdrop no longer
 * dismisses. For a dialog that exists to confirm something irreversible, a
 * stray click outside it should not be a way to answer.
 */
import { signal } from "@preact/signals";
import { useState } from "preact/hooks";

import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

export interface ConfirmActionRequest {
  title: string;
  /** One short sentence of context shown under the title. */
  body?: string;
  /** What will actually happen, one clause per line. */
  consequences?: readonly string[];
  /** Names the action, e.g. "Remove from organization" — never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /**
   * For irreversible operations: the exact string the user must type back
   * (usually the target's name or email) before confirm enables.
   */
  typedConfirmation?: string;
  /**
   * What the action applies to, when that is a choice rather than a given.
   *
   * A decision with a scope is still one decision: joining a group on behalf
   * of two of your three affiliations is not three dialogs, and it is not a
   * set of checkboxes standing open on a page beside every group in a list
   * (#51). The dialog that asks "are you sure" is the right place to ask "for
   * which", because both are answered at the same moment.
   *
   * Every choice starts selected: the common case is all of them, and a
   * reader who wants a subset clears the ones they do not want.
   */
  choices?: readonly ConfirmChoice[];
}

export interface ConfirmChoice {
  id: string;
  label: string;
  /** Names the set, for a reader who hears the group before its options. */
  legend?: string;
}

interface ActiveConfirm extends ConfirmActionRequest {
  /** The chosen ids, or `null` for cancelled. A choiceless dialog answers `[]`. */
  resolve: (chosen: string[] | null) => void;
}

const activeConfirm = signal<ActiveConfirm | null>(null);

function ask(request: ConfirmActionRequest): Promise<string[] | null> {
  return new Promise((resolve) => {
    // A second request while one is open cancels the first rather than
    // silently stacking two decisions.
    activeConfirm.value?.resolve(null);
    activeConfirm.value = { ...request, resolve };
  });
}

/** Ask the user to confirm an action; resolves false on cancel or Escape. */
export function confirmAction(request: ConfirmActionRequest): Promise<boolean> {
  return ask(request).then((chosen) => chosen !== null);
}

/**
 * Ask the user to confirm an action AND say what it applies to.
 *
 * Resolves the chosen ids, or `null` when the reader backs out — which is a
 * different answer from "confirmed, nothing selected", and the caller has to
 * be able to tell them apart.
 */
export function confirmSelection(
  request: ConfirmActionRequest & { choices: readonly ConfirmChoice[] },
): Promise<string[] | null> {
  return ask(request);
}

function settle(chosen: string[] | null): void {
  const current = activeConfirm.value;
  activeConfirm.value = null;
  current?.resolve(chosen);
}

/**
 * The scope of the decision, asked in the dialog that is already asking for
 * it. Keyed by the request so a second dialog starts from its own defaults
 * rather than inheriting the last one's selection.
 */
function ConfirmChoices({
  choices,
  selected,
  onToggle,
}: {
  choices: readonly ConfirmChoice[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset class="pk-fieldset pk-field">
      <legend class="pk-field__label">{choices[0]?.legend ?? "Applies to"}</legend>
      <div class="pk-stack pk-stack--snug">
        {choices.map((choice) => (
          <Checkbox
            key={choice.id}
            checked={selected.has(choice.id)}
            onChange={() => onToggle(choice.id)}
            label={choice.label}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function ConfirmDialogHost() {
  const request = activeConfirm.value;

  // Rendered only while a decision is pending, so a closed host leaves nothing
  // in the accessibility tree for a test — or a screen reader — to find.
  if (!request) return null;

  return <ConfirmDialogBody request={request} />;
}

function ConfirmDialogBody({ request }: { request: ActiveConfirm }) {
  const choices = request.choices ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(choices.map((choice) => choice.id)));

  return (
    <div class="pk">
      <Dialog
        open
        title={request.title}
        description={request.body}
        consequences={request.consequences}
        confirmPhrase={request.typedConfirmation}
        confirmPrompt={request.typedConfirmation ? `Type ${request.typedConfirmation} to confirm` : undefined}
        confirmLabel={request.confirmLabel}
        cancelLabel={request.cancelLabel}
        // Confirmations default to destructive: the ones that are not are the
        // exception, and treating a removal as routine is the worse mistake.
        destructive={request.tone !== "primary"}
        // A scoped decision cannot be confirmed with nothing in scope.
        confirmDisabled={choices.length > 0 && selected.size === 0}
        onConfirm={() => settle([...selected])}
        onCancel={() => settle(null)}
      >
        {choices.length > 0 && (
          <ConfirmChoices
            choices={choices}
            selected={selected}
            onToggle={(id) =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        )}
      </Dialog>
    </div>
  );
}
