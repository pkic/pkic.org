/**
 * InputGroup — a field's control and its one action in a single row.
 *
 * Place it inside a `Field` so the label, help, and message stay above and
 * below the row and never move it. The input takes the width left over; the
 * action keeps its label width, and both are exactly one control tall.
 */

import type { ComponentChildren } from "preact";

import "./InputGroup.css";

export function InputGroup({
  children,
  joined = false,
  prefix,
}: {
  children: ComponentChildren;
  /** Attach the prefix, input, and action with shared edges. */
  joined?: boolean;
  prefix?: ComponentChildren;
}) {
  return (
    <div class={`pk-input-group${joined ? " pk-input-group--joined" : ""}`}>
      {prefix != null && <span class="pk-input-group__prefix">{prefix}</span>}
      {children}
    </div>
  );
}
