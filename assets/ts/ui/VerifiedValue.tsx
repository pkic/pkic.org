/**
 * VerifiedValue — a value followed by its confirmation state.
 *
 * A confirmed value carries a green tick; one still awaiting confirmation says
 * so in muted text. The tick has a spoken label, so the state never rests on
 * color alone.
 */

import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useState } from "preact/hooks";

import { IconCheckmark } from "../components/icons";
import { IconClock } from "./MediaIcons";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

import "./VerifiedValue.css";

export function VerifiedValue({
  children,
  verified,
  pendingLabel = "confirmation pending",
  confirmedLabel = "Confirmed",
  pendingExplanation,
}: {
  children: ComponentChildren;
  verified: boolean;
  pendingLabel?: string;
  confirmedLabel?: string;
  /** A compact status control opens this explanation on phones as well as desktop. */
  pendingExplanation?: string;
}) {
  const [explaining, setExplaining] = useState(false);
  return (
    <span class="pk-verified-value">
      <span>{children}</span>
      {verified ? (
        <span class="pk-verified-value__mark" title={confirmedLabel}>
          <IconCheckmark />
          <span class="pk-sr-only">{confirmedLabel.toLowerCase()}</span>
        </span>
      ) : pendingExplanation ? (
        <>
          <Button
            variant="ghost"
            icon
            aria-label={pendingLabel}
            title={pendingLabel}
            onClick={() => setExplaining(true)}
          >
            <IconClock />
          </Button>
          {explaining &&
            createPortal(
              <Dialog
                open
                title={pendingLabel}
                confirmLabel="Close"
                cancelLabel={null}
                onConfirm={() => setExplaining(false)}
                onCancel={() => setExplaining(false)}
              >
                <p>{pendingExplanation}</p>
              </Dialog>,
              document.body,
            )}
        </>
      ) : (
        <small class="pk-verified-value__pending">{pendingLabel}</small>
      )}
    </span>
  );
}
