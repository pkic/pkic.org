/**
 * What a list is currently narrowed to, stated above its rows.
 *
 * Two bands, both siblings of the table inside `pk-table-list` rather than
 * wrappers around it: the frame is a flex column whose regions separate with
 * rules and a zero gap, so anything that wraps the table would break the
 * band model.
 *
 *   - `AppliedFilterChips` names every narrowing in force — a column filter,
 *     a hidden column — and lets the reader undo each one where they can see
 *     it. A column menu states the narrowing at the column; this states the
 *     whole query, because a reader looking at eleven rows needs to know why
 *     it is eleven without opening four menus to find out.
 *   - `ColumnTextFilterRow` is the open-vocabulary counterpart to the enum
 *     options a column menu offers. A short known value set belongs in the
 *     menu itself; a name or an organization does not, and typing it is the
 *     only sensible control.
 *
 * The query lives in the list controller, which sends it to the server. A
 * typed filter keeps a contract-validated local draft until Enter or Done.
 */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { useContractForm } from "../hooks/useContractForm";
import { Field } from "../ui/Field";

import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextControl";
import "./table-filter-strip.css";

export interface AppliedFilterChip {
  /** Stable identity for the chip, unique within one strip. */
  id: string;
  /** What is in force, in words: "Role: Observer", "Joined hidden". */
  label: string;
  /** Names the clear control for a reader who cannot see the chip's context. */
  clearLabel: string;
  onClear: () => void;
}

export function AppliedFilterChips({ chips }: { chips: readonly AppliedFilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div class="pk-applied-filters">
      <span class="pk-small pk-muted pk-applied-filters__lede">Showing</span>
      <ul class="pk-applied-filters__list">
        {chips.map((chip) => (
          <li key={chip.id}>
            {/*
              The chip is one control, not a label beside a close button: two
              adjacent targets that do the same thing read as two commands to
              anyone navigating by keyboard, and the smaller of them is the
              one that fails a pointer target size check.
            */}
            <button type="button" class="pk-applied-filters__chip" onClick={chip.onClear} aria-label={chip.clearLabel}>
              <span>{chip.label}</span>
              <span class="pk-applied-filters__dismiss" aria-hidden="true">
                ×
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ColumnTextFilterRowProps {
  /** The column being narrowed, named as its header reads. */
  columnLabel: string;
  value: string;
  placeholder?: string;
  /** Where the matching happens, said plainly under the control. */
  hint?: ComponentChildren;
  /** Shared query contract for the draft committed with Enter or Done. */
  schema: z.ZodType<Record<string, string | undefined>>;
  param: string;
  onInput: (value: string) => void;
  onClose: () => void;
}

export function ColumnTextFilterRow({
  columnLabel,
  value,
  schema,
  param,
  placeholder,
  hint,
  onInput,
  onClose,
}: ColumnTextFilterRowProps) {
  const [draft, setDraft] = useState(value);
  const form = useContractForm(schema, { [param]: draft.trim() ? draft : undefined });
  const resetValidation = form.reset;
  useLayoutEffect(() => {
    setDraft(value);
    resetValidation();
  }, [value, resetValidation]);
  return (
    <form
      class="pk-column-filter"
      noValidate
      {...form.handlers}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const checked = form.submit();
        if (!checked.data) return;
        const nextValue = checked.data[param] ?? "";
        if (nextValue !== value) onInput(nextValue);
        onClose();
      }}
    >
      <div class="pk-column-filter__field">
        <Field
          label={`Filter ${columnLabel}`}
          help={
            <>
              {hint && <>{hint} </>}
              Press Enter or Done to apply the filter.
            </>
          }
          {...form.of(param)}
        >
          {(control) => (
            <TextInput
              {...control}
              name={param}
              value={draft}
              placeholder={placeholder}
              autofocus
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
          )}
        </Field>
      </div>
      <Button variant="secondary" type="button" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit">Done</Button>
    </form>
  );
}
