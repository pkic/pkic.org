import { Badge, DataTable, Pager, PersonCell, RowActions, Toolbar } from "pkic-org-events-backend";

/**
 * DataTable is the portal's roster, registry and audit surface. It is never a
 * bare table on the canvas: the list frame (`pk-table-list`) puts the head,
 * the rows and the pager inside one panel, so every cell here composes it the
 * way a real screen does.
 */
const noop = () => {};

interface Delegate {
  id: string;
  name: string;
  email: string;
  organization: string;
  role: string;
  joined: string;
}

const DELEGATES: Delegate[] = [
  {
    id: "d1",
    name: "Tomas Riedel",
    email: "tomas.riedel@securetrust.example",
    organization: "SecureTrust Authority",
    role: "Chair",
    joined: "2021-04-12",
  },
  {
    id: "d2",
    name: "Amara Osei",
    email: "amara.osei@northgate-pki.example",
    organization: "Northgate PKI Services",
    role: "Vice chair",
    joined: "2022-09-01",
  },
  {
    id: "d3",
    name: "Lena Fischer",
    email: "lena.fischer@quantumroot.example",
    organization: "QuantumRoot GmbH",
    role: "Delegate",
    joined: "2023-01-30",
  },
  {
    id: "d4",
    name: "Sanjay Deshpande",
    email: "s.deshpande@certnet-global.example",
    organization: "CertNet Global",
    role: "Delegate",
    joined: "2024-06-18",
  },
  {
    id: "d5",
    name: "Marta Oliveira",
    email: "marta.oliveira@ibericatrust.example",
    organization: "Ibérica Trust Services",
    role: "Observer",
    joined: "2025-02-05",
  },
];

const rowMenu = (name: string) => [
  { id: "profile", label: "View profile", onSelect: noop },
  { id: "email", label: "Send message", onSelect: noop },
  {
    id: "remove",
    label: `Remove ${name} from the group`,
    onSelect: noop,
    danger: true,
    separatorBefore: true,
  },
];

/**
 * The canonical list: a sorted, navigable roster with a leading person column,
 * a bounded date column and the row's own commands at the end.
 */
export function WorkingGroupRoster() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <DataTable
          caption="Post-Quantum Cryptography working group roster"
          columns={[
            {
              id: "person",
              header: "Delegate",
              sortable: true,
              width: "primary",
              cell: (row: Delegate) => <PersonCell name={row.name} email={row.email} size="sm" />,
            },
            {
              id: "organization",
              header: "Member organization",
              cell: (row: Delegate) => row.organization,
            },
            {
              id: "joined",
              header: "Joined",
              sortable: true,
              width: "fit",
              cell: (row: Delegate) => row.joined,
            },
            {
              id: "actions",
              header: "Actions",
              headerHidden: true,
              align: "end",
              width: "fit",
              cell: (row: Delegate) => (
                <RowActions
                  subject={row.name}
                  status={
                    row.role === "Chair" ? (
                      <Badge tone="accent">Chair</Badge>
                    ) : row.role === "Observer" ? (
                      <Badge tone="neutral">Observer</Badge>
                    ) : undefined
                  }
                  actions={rowMenu(row.name)}
                />
              ),
            },
          ]}
          rows={DELEGATES}
          rowKey={(row: Delegate) => row.id}
          sort={{ columnId: "person", direction: "asc" }}
          onSort={noop}
          rowAction={(row: Delegate) => ({ label: `Open ${row.name}`, href: `#${row.id}` })}
        />
        <Pager
          label="Roster pagination"
          page={1}
          pageCount={4}
          total={18}
          rangeStart={1}
          rangeEnd={5}
          onSelect={noop}
        />
      </div>
    </div>
  );
}

/**
 * Selection: every row carries a checkbox with a real name, and the header
 * checkbox takes the whole page. Shown with the toolbar the list head owns.
 */
export function SelectableWithSelection() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <Toolbar
          label="Certificate agreement controls"
          search={{
            value: "quantum",
            placeholder: "Search agreements",
            onInput: noop,
            label: "Search certificate agreements",
          }}
        />
        <DataTable
          caption="Signed membership agreements"
          columns={[
            {
              id: "organization",
              header: "Organization",
              width: "primary",
              cell: (row: Delegate) => row.organization,
            },
            {
              id: "signatory",
              header: "Signatory",
              cell: (row: Delegate) => row.name,
            },
            {
              id: "signed",
              header: "Signed",
              sortable: true,
              width: "fit",
              cell: (row: Delegate) => row.joined,
            },
            {
              id: "state",
              header: "State",
              width: "fit",
              cell: (row: Delegate) =>
                row.id === "d4" ? (
                  <Badge tone="warn">Awaiting counter-signature</Badge>
                ) : (
                  <Badge tone="ok">Countersigned</Badge>
                ),
            },
          ]}
          rows={DELEGATES.slice(0, 4)}
          rowKey={(row: Delegate) => row.id}
          sort={{ columnId: "signed", direction: "desc" }}
          onSort={noop}
          selection={{
            selected: new Set(["d2", "d3"]),
            onChange: noop,
            rowLabel: (key: string) =>
              `Select ${DELEGATES.find((delegate) => delegate.id === key)?.organization ?? key}`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * A detail row belongs to the row above it and spans every column — here the
 * reason an outbox message failed, opened under the message it belongs to.
 */
export function WithDetailRow() {
  interface Message {
    id: string;
    recipient: string;
    template: string;
    queued: string;
    state: string;
  }

  const messages: Message[] = [
    {
      id: "o1",
      recipient: "tomas.riedel@securetrust.example",
      template: "group-invitation",
      queued: "2026-08-30 09:14 UTC",
      state: "Sent",
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
  ];

  return (
    <div class="pk">
      <div class="pk-table-list">
        <DataTable
          caption="Email outbox"
          columns={[
            { id: "recipient", header: "Recipient", width: "primary", cell: (row: Message) => row.recipient },
            {
              id: "template",
              header: "Template",
              cellClass: "pk-small pk-muted",
              cell: (row: Message) => row.template,
            },
            { id: "queued", header: "Queued", width: "fit", cell: (row: Message) => row.queued },
            {
              id: "state",
              header: "State",
              width: "fit",
              cell: (row: Message) =>
                row.state === "Failed" ? (
                  <Badge tone="danger" dot>
                    Failed
                  </Badge>
                ) : row.state === "Queued" ? (
                  <Badge tone="info" dot>
                    Queued
                  </Badge>
                ) : (
                  <Badge tone="ok" dot>
                    Sent
                  </Badge>
                ),
            },
          ]}
          rows={messages}
          rowKey={(row: Message) => row.id}
          detailRow={(row: Message) =>
            row.state === "Failed" ? (
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong">Delivery rejected after 3 attempts</span>
                <span class="pk-small pk-muted">
                  550 5.7.1 Message rejected by the recipient's mail gateway. Retry once the domain's SPF record lists the
                  consortium sender.
                </span>
              </div>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/** The two states a list spends real time in: waiting for rows, and having none. */
export function LoadingAndEmpty() {
  const columns = [
    { id: "organization", header: "Organization", width: "primary" as const, cell: (row: Delegate) => row.organization },
    { id: "role", header: "Role", cell: (row: Delegate) => row.role },
    { id: "joined", header: "Joined", width: "fit" as const, cell: (row: Delegate) => row.joined },
  ];

  return (
    <div class="pk pk-stack">
      <div class="pk-table-list">
        <DataTable
          caption="Member organizations, loading"
          columns={columns}
          rows={[]}
          rowKey={(row: Delegate) => row.id}
          loading
          loadingRows={3}
        />
      </div>
      <div class="pk-table-list">
        <DataTable
          caption="Member organizations, none yet"
          columns={columns}
          rows={[]}
          rowKey={(row: Delegate) => row.id}
          empty={
            <div class="pk-stack pk-stack--tight pk-center">
              <span class="pk-strong">No organizations have joined this group yet.</span>
              <span class="pk-small pk-muted">Invite a member organization to start the roster.</span>
            </div>
          }
        />
      </div>
    </div>
  );
}
