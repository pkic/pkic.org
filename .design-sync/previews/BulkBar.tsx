import { Badge, BulkBar, Button, DataTable, Toolbar } from "pkic-org-events-backend";

/**
 * BulkBar is the strip that appears between a list's head and its rows while
 * rows are selected. It renders nothing at a count of zero, so every cell here
 * shows it in the only place it exists: above a table with a live selection.
 */
const noop = () => {};

interface Message {
  id: string;
  recipient: string;
  template: string;
  queued: string;
  state: "Queued" | "Failed" | "Sent";
}

const MESSAGES: Message[] = [
  {
    id: "o1",
    recipient: "tomas.riedel@securetrust.example",
    template: "group-invitation",
    queued: "2026-08-30 09:14 UTC",
    state: "Failed",
  },
  {
    id: "o2",
    recipient: "amara.osei@northgate-pki.example",
    template: "charter-approval",
    queued: "2026-08-30 09:16 UTC",
    state: "Failed",
  },
  {
    id: "o3",
    recipient: "lena.fischer@quantumroot.example",
    template: "meeting-reminder",
    queued: "2026-08-30 10:02 UTC",
    state: "Queued",
  },
  {
    id: "o4",
    recipient: "s.deshpande@certnet-global.example",
    template: "meeting-reminder",
    queued: "2026-08-30 10:02 UTC",
    state: "Sent",
  },
];

const stateBadge = (state: Message["state"]) =>
  state === "Failed" ? (
    <Badge tone="danger" dot>
      Failed
    </Badge>
  ) : state === "Queued" ? (
    <Badge tone="info" dot>
      Queued
    </Badge>
  ) : (
    <Badge tone="ok" dot>
      Sent
    </Badge>
  );

const messageColumns = [
  { id: "recipient", header: "Recipient", width: "primary" as const, cell: (row: Message) => row.recipient },
  {
    id: "template",
    header: "Template",
    cellClass: "pk-small pk-muted",
    cell: (row: Message) => row.template,
  },
  { id: "queued", header: "Queued", width: "fit" as const, cell: (row: Message) => row.queued },
  { id: "state", header: "State", width: "fit" as const, cell: (row: Message) => stateBadge(row.state) },
];

const selection = (selected: string[]) => ({
  selected: new Set(selected),
  onChange: noop,
  rowLabel: (key: string) => `Select the message to ${MESSAGES.find((m) => m.id === key)?.recipient ?? key}`,
});

/**
 * The canonical position: head, then the strip, then the rows it counts —
 * inside one list panel, with the commands that take the selected ids.
 */
export function AboveSelectedRows() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <Toolbar
          label="Email outbox controls"
          search={{ value: "", placeholder: "Search recipients", onInput: noop, label: "Search the email outbox" }}
        />
        <BulkBar count={2} total={48} onClear={noop}>
          <Button size="sm" variant="secondary">
            Process selected
          </Button>
          <Button size="sm" variant="danger-quiet">
            Reset failed
          </Button>
        </BulkBar>
        <DataTable
          caption="Email outbox"
          columns={messageColumns}
          rows={MESSAGES}
          rowKey={(row: Message) => row.id}
          selection={selection(["o1", "o2"])}
        />
      </div>
    </div>
  );
}

interface Delegate {
  id: string;
  name: string;
  email: string;
  organization: string;
  role: string;
}

const DELEGATES: Delegate[] = [
  {
    id: "d1",
    name: "Tomas Riedel",
    email: "tomas.riedel@securetrust.example",
    organization: "SecureTrust Authority",
    role: "Chair",
  },
  {
    id: "d2",
    name: "Amara Osei",
    email: "amara.osei@northgate-pki.example",
    organization: "Northgate PKI Services",
    role: "Vice chair",
  },
  {
    id: "d3",
    name: "Lena Fischer",
    email: "lena.fischer@quantumroot.example",
    organization: "QuantumRoot GmbH",
    role: "Delegate",
  },
  {
    id: "d4",
    name: "Sanjay Deshpande",
    email: "s.deshpande@certnet-global.example",
    organization: "CertNet Global",
    role: "Observer",
  },
];

/**
 * The whole page selected, and the roster commands that take the selected
 * ids. A count equal to the total is the moment a reader checks before acting
 * on everything.
 */
export function WholePageSelected() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <BulkBar count={4} total={4} onClear={noop}>
          <Button size="sm" variant="secondary">
            Export roster
          </Button>
          <Button size="sm" variant="secondary">
            Send meeting invitation
          </Button>
          <Button size="sm" variant="danger-quiet">
            Remove from group
          </Button>
        </BulkBar>
        <DataTable
          caption="Post-Quantum Cryptography delegates"
          columns={[
            { id: "name", header: "Delegate", width: "primary" as const, cell: (row: Delegate) => row.name },
            { id: "email", header: "Email", cell: (row: Delegate) => row.email },
            {
              id: "organization",
              header: "Member organization",
              cell: (row: Delegate) => row.organization,
            },
            { id: "role", header: "Role", width: "fit" as const, cell: (row: Delegate) => row.role },
          ]}
          rows={DELEGATES}
          rowKey={(row: Delegate) => row.id}
          selection={{
            selected: new Set(["d1", "d2", "d3", "d4"]),
            onChange: noop,
            rowLabel: (key: string) => `Select ${DELEGATES.find((d) => d.id === key)?.name ?? key}`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * A selection larger than the request can carry: the strip is where the limit
 * is stated, beside the disabled commands it applies to.
 */
export function SelectionOverTheRequestLimit() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <BulkBar count={260} total={588} onClear={noop}>
          <span class="pk-small">Selection exceeds the 250-message limit per request.</span>
          <Button size="sm" variant="secondary" disabled>
            Process selected
          </Button>
          <Button size="sm" variant="danger-quiet" disabled>
            Reset failed
          </Button>
        </BulkBar>
        <DataTable
          caption="Email outbox, filtered to failed messages"
          columns={messageColumns}
          rows={MESSAGES.slice(0, 3)}
          rowKey={(row: Message) => row.id}
          selection={selection(["o1", "o2", "o3"])}
        />
      </div>
    </div>
  );
}
