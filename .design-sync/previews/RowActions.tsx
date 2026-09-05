import { Badge, PersonCell, RowActions } from "pkic-org-events-backend";

/**
 * RowActions is a table row's trailing cell — status then the overflow menu,
 * pushed to the end of the row. Alone in a card it reads as a stray glyph, so
 * both cells compose it in the row context it is designed for.
 */
const noop = () => {};

export function InAMemberRow() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <div class="pk-cluster pk-cluster--between">
        <PersonCell name="Tomas Riedel" email="tomas.riedel@example.org" />
        <RowActions
          subject="Tomas Riedel"
          status={<Badge tone="ok">Active</Badge>}
          actions={[
            { id: "view", label: "View profile", onSelect: noop },
            { id: "email", label: "Send message", onSelect: noop },
            { id: "remove", label: "Remove from group", onSelect: noop, danger: true, separatorBefore: true },
          ]}
        />
      </div>
      <div class="pk-cluster pk-cluster--between">
        <PersonCell name="Amara Osei" email="amara.osei@example.org" />
        <RowActions
          subject="Amara Osei"
          status={<Badge tone="warn">Pending</Badge>}
          actions={[
            { id: "view", label: "View profile", onSelect: noop },
            { id: "resend", label: "Resend invitation", onSelect: noop },
          ]}
        />
      </div>
    </div>
  );
}

export function ActionsOnly() {
  return (
    <div class="pk">
      <div class="pk-cluster pk-cluster--between">
        <span class="pk-strong">Quantum-Safe Cryptography charter</span>
        <RowActions
          subject="Quantum-Safe Cryptography charter"
          actions={[
            { id: "download", label: "Download PDF", onSelect: noop },
            { id: "replace", label: "Replace document", onSelect: noop },
          ]}
        />
      </div>
    </div>
  );
}
