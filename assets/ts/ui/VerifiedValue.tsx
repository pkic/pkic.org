/**
 * VerifiedValue — a value followed by its confirmation state.
 *
 * A confirmed value carries a green tick; one still awaiting confirmation says
 * so in muted text. The tick has a spoken label, so the state never rests on
 * color alone.
 */

import type { ComponentChildren } from "preact";

import { IconCheckmark } from "../components/icons";

import "./VerifiedValue.css";

export function VerifiedValue({
  children,
  verified,
  pendingLabel = "confirmation pending",
}: {
  children: ComponentChildren;
  verified: boolean;
  pendingLabel?: string;
}) {
  return (
    <span class="pk-verified-value">
      <span>{children}</span>
      {verified ? (
        <span class="pk-verified-value__mark" title="Confirmed">
          <IconCheckmark />
          <span class="pk-sr-only">confirmed</span>
        </span>
      ) : (
        <small class="pk-verified-value__pending">{pendingLabel}</small>
      )}
    </span>
  );
}
