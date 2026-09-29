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
 * Neither owns any filter state. Both render what the table was told and call
 * back — the query lives in the list controller, which sends it to the server.
 */
import type { ComponentChildren } from "preact";

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
  /** Values the server offers for this column; may be empty. */
  suggestions?: readonly string[];
  placeholder?: string;
  /** Where the matching happens, said plainly under the control. */
  hint?: ComponentChildren;
  onInput: (value: string) => void;
  onClose: () => void;
}

export function ColumnTextFilterRow({
  columnLabel,
  value,
  suggestions = [],
  placeholder,
  hint,
  onInput,
  onClose,
}: ColumnTextFilterRowProps) {
  const listId = `filter-values-${columnLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div class="pk-column-filter">
      <label class="pk-column-filter__field">
        <span class="pk-small pk-strong">Filter {columnLabel.toLowerCase()}</span>
        <TextInput
          list={suggestions.length > 0 ? listId : undefined}
          value={value}
          placeholder={placeholder ?? "Contains…"}
          // The reader opened this from a menu item; focus is the whole point
          // of the row appearing, and without it they have to find it again.
          autofocus
          onInput={(event) => {
            onInput((event.currentTarget as HTMLInputElement).value);
          }}
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        )}
        {hint !== undefined && <span class="pk-small pk-muted">{hint}</span>}
      </label>
      <Button variant="secondary" size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
