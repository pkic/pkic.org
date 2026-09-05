import { Badge, DataTable, PersonCell, RowActions } from "pkic-org-events-backend";

/**
 * PersonCell is one person as a table row reads them: a face, the name, and
 * the address that tells two people with the same name apart.
 */
const noop = () => {};

/** Stands in for an uploaded headshot, so the preview fetches nothing. */
const HEADSHOT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect fill='%23264653' width='64' height='64'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23e9c46a'/%3E%3Cpath d='M8 64c0-14 11-22 24-22s24 8 24 22z' fill='%23e9c46a'/%3E%3C/svg%3E";

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
    role: "Delegate",
  },
];

/** Where it earns its keep: the leading column of a roster. */
export function AsARosterColumn() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <DataTable
          caption="Certificate Lifecycle Automation roster"
          columns={[
            {
              id: "person",
              header: "Delegate",
              width: "primary",
              cell: (row: Delegate) => <PersonCell name={row.name} email={row.email} size="sm" />,
            },
            {
              id: "organization",
              header: "Member organization",
              cell: (row: Delegate) => row.organization,
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
                  status={row.role === "Chair" ? <Badge tone="accent">Chair</Badge> : undefined}
                  actions={[
                    { id: "profile", label: "View profile", onSelect: noop },
                    { id: "email", label: "Send message", onSelect: noop },
                  ]}
                />
              ),
            },
          ]}
          rows={DELEGATES}
          rowKey={(row: Delegate) => row.id}
        />
      </div>
    </div>
  );
}

/**
 * The size axis. `md` is the default and is what a record header or a card
 * uses; `sm` is the dense row inside a table.
 */
export function Sizes() {
  return (
    <div class="pk pk-stack">
      <div class="pk-stack pk-stack--tight">
        <span class="pk-small pk-muted">md — the default, for a record header or a card</span>
        <PersonCell name="Tomas Riedel" email="tomas.riedel@securetrust.example" />
        <PersonCell name="Marta Oliveira" email="marta.oliveira@ibericatrust.example" />
      </div>
      <div class="pk-stack pk-stack--tight">
        <span class="pk-small pk-muted">sm — inside a table row</span>
        <PersonCell name="Tomas Riedel" email="tomas.riedel@securetrust.example" size="sm" />
        <PersonCell name="Marta Oliveira" email="marta.oliveira@ibericatrust.example" size="sm" />
      </div>
    </div>
  );
}

/**
 * What the cell falls back to: initials when there is no headshot, and a
 * single line when the record holds no address to show.
 */
export function AvatarAndSecondLine() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <PersonCell name="Amara Osei" email="amara.osei@northgate-pki.example" avatarSrc={HEADSHOT} />
      <PersonCell name="Sanjay Deshpande" email="s.deshpande@certnet-global.example" />
      <PersonCell name="Quantum-Safe Cryptography secretariat" />
    </div>
  );
}
