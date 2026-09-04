/**
 * The control that opens the rest of a list, across the foot of its panel.
 *
 * A long history — every organization someone has represented, every past
 * charter — should not push the panels under it off the screen, but it should
 * not be hidden behind a control the reader has to hunt for either. This sits
 * where the list stops, states how many more there are, and takes the full
 * width so it reads as the end of the panel rather than a button in it.
 */
import "./ExpandFooter.css";

export interface ExpandFooterProps {
  expanded: boolean;
  onToggle: () => void;
  /**
   * How many entries are still hidden. Shown as "+3" while collapsed and used
   * to write the accessible name, so the control announces what it will do
   * rather than just "expand".
   */
  hiddenCount: number;
  /** What is being counted, plural: "organizations", "charters". */
  noun: string;
}

export function ExpandFooter({ expanded, onToggle, hiddenCount, noun }: ExpandFooterProps) {
  if (hiddenCount <= 0 && !expanded) return null;

  const label = expanded ? `Show fewer ${noun}` : `Show ${String(hiddenCount)} more ${noun}`;

  return (
    <button type="button" class="pk-expand-footer" onClick={onToggle} aria-expanded={expanded} aria-label={label}>
      <span>{expanded ? "Show fewer" : `+${String(hiddenCount)}`}</span>
      {/* The caret repeats the state the button already announces through
          aria-expanded, so it is decoration. */}
      <span class="pk-expand-footer__caret" aria-hidden="true">
        {expanded ? "▲" : "▼"}
      </span>
    </button>
  );
}
