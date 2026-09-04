import { Toast } from "pkic-org-events-backend";

/**
 * A transient confirmation of something the operator just did — role="status",
 * never an interruption. The tone axis is swept first; the other cells add the
 * optional action and dismiss controls.
 */

const noop = () => {};

export function Tones() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Toast tone="ok" message="Charter published to all members." />
      <Toast tone="info" message="Roster export queued — it will arrive by email." />
      <Toast tone="danger" message="Invitation to amara.osei@example.org could not be delivered." />
    </div>
  );
}

export function WithAction() {
  return (
    <div class="pk">
      <Toast
        tone="ok"
        message="Tomas Riedel removed from Post-Quantum Cryptography."
        action={{ label: "Undo", onSelect: noop }}
      />
    </div>
  );
}

export function ActionAndDismiss() {
  return (
    <div class="pk">
      <Toast
        tone="info"
        message="Membership agreement 2026 is awaiting a countersignature."
        action={{ label: "Review", onSelect: noop }}
        onDismiss={noop}
      />
    </div>
  );
}

export function RecoverableFailure() {
  return (
    <div class="pk">
      <Toast
        tone="danger"
        message="The signature on the uploaded agreement did not verify against the issuing CA."
        action={{ label: "Retry upload", onSelect: noop }}
        onDismiss={noop}
      />
    </div>
  );
}
