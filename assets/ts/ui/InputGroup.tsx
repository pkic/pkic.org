/**
 * InputGroup — a field's control and its one action in a single row.
 *
 * Place it inside a `Field` so the label, help, and message stay above and
 * below the row and never move it. The input takes the width left over; the
 * action keeps its label width, and both are exactly one control tall.
 */

import { toChildArray, type ComponentChildren } from "preact";

import "./InputGroup.css";

export interface InputGroupProps {
  children: ComponentChildren;
  joined?: boolean;
  prefix?: ComponentChildren;
  /** Field places its validation mark beside the input, inside this control. */
  status?: ComponentChildren;
}

export function InputGroup({ children, joined = false, prefix, status }: InputGroupProps) {
  const [control, ...actions] = toChildArray(children);
  return (
    <div class={`pk-input-group${joined ? " pk-input-group--joined" : ""}`}>
      {prefix != null && <span class="pk-input-group__prefix">{prefix}</span>}
      {status !== undefined ? (
        <>
          <div class="pk-input-group__control">
            {control}
            {status}
          </div>
          {actions}
        </>
      ) : (
        children
      )}
    </div>
  );
}
