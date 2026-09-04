import { Button, Chip, DataTable, Menu, Pager, Toolbar } from "pkic-org-events-backend";

/**
 * Toolbar is the head band of a list panel: the field that finds a row, then
 * the filters and the one action the list offers. It is never a bare strip on
 * the canvas, so each cell shows it on top of the list it controls.
 */
const noop = () => {};

interface Organization {
  id: string;
  name: string;
  country: string;
  membership: string;
  joined: string;
}

const ORGANIZATIONS: Organization[] = [
  {
    id: "o1",
    name: "SecureTrust Authority",
    country: "Norway",
    membership: "Full member",
    joined: "2021-04-12",
  },
  {
    id: "o2",
    name: "Northgate PKI Services",
    country: "United Kingdom",
    membership: "Full member",
    joined: "2022-09-01",
  },
  { id: "o3", name: "QuantumRoot GmbH", country: "Germany", membership: "Associate", joined: "2023-01-30" },
  { id: "o4", name: "CertNet Global", country: "Singapore", membership: "Full member", joined: "2024-06-18" },
];

const columns = [
  { id: "name", header: "Organization", width: "primary" as const, cell: (row: Organization) => row.name },
  { id: "country", header: "Country", cell: (row: Organization) => row.country },
  { id: "membership", header: "Membership", width: "fit" as const, cell: (row: Organization) => row.membership },
  { id: "joined", header: "Joined", width: "fit" as const, cell: (row: Organization) => row.joined },
];

interface Charter {
  id: string;
  title: string;
  group: string;
  version: string;
  ratified: string;
}

const CHARTERS: Charter[] = [
  {
    id: "c1",
    title: "Quantum-Safe Cryptography charter",
    group: "Post-Quantum Cryptography",
    version: "v2",
    ratified: "2026-03-02",
  },
  {
    id: "c2",
    title: "Certificate lifecycle automation charter",
    group: "Certificate Lifecycle Automation",
    version: "v1",
    ratified: "2025-11-18",
  },
  {
    id: "c3",
    title: "Trust list governance charter",
    group: "Trust List Governance",
    version: "v3",
    ratified: "2024-09-05",
  },
];

/**
 * The canonical head: a search field named after this list, and the list's
 * own create action at full size beside it.
 */
export function AboveAMemberDirectory() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <Toolbar
          label="Member organization controls"
          search={{
            value: "",
            placeholder: "Search organizations",
            onInput: noop,
            label: "Search member organizations",
          }}
        >
          <Button variant="primary">Invite organization</Button>
        </Toolbar>
        <DataTable
          caption="Member organizations"
          columns={columns}
          rows={ORGANIZATIONS}
          rowKey={(row: Organization) => row.id}
        />
        <Pager
          label="Member organization pagination"
          page={1}
          pageCount={6}
          total={132}
          rangeStart={1}
          rangeEnd={4}
          onSelect={noop}
        />
      </div>
    </div>
  );
}

/**
 * A search already in force, with the filters it is narrowed by shown as
 * removable chips and the rest of the commands behind one menu.
 */
export function SearchWithActiveFilters() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <Toolbar
          label="Member organization controls"
          search={{
            value: "quantum",
            placeholder: "Search organizations",
            onInput: noop,
            label: "Search member organizations",
          }}
        >
          <Chip onRemove={noop} removeLabel="Membership: Full member">
            Membership: Full member
          </Chip>
          <Chip pressed onToggle={noop}>
            Founding members
          </Chip>
          <Menu
            label="Directory actions"
            heading="Member directory"
            align="end"
            items={[
              { id: "export", label: "Export as CSV", onSelect: noop },
              { id: "print", label: "Print directory", onSelect: noop },
              { id: "archive", label: "Archive selected members", onSelect: noop, danger: true, separatorBefore: true },
            ]}
          />
        </Toolbar>
        <DataTable
          caption="Member organizations, filtered"
          columns={columns}
          rows={ORGANIZATIONS.slice(0, 3)}
          rowKey={(row: Organization) => row.id}
        />
      </div>
    </div>
  );
}

/**
 * No search: some lists are short enough that finding a row is not the
 * problem, and the head carries only what can be done to the list.
 */
export function ActionsWithoutSearch() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <Toolbar label="Charter document controls">
          <Chip pressed onToggle={noop}>
            Ratified
          </Chip>
          <Chip onToggle={noop}>Draft</Chip>
          <Chip onToggle={noop}>Superseded</Chip>
          <Button variant="secondary">Download all</Button>
          <Button variant="primary">Upload charter</Button>
        </Toolbar>
        <DataTable
          caption="Charter documents"
          columns={[
            { id: "title", header: "Charter", width: "primary" as const, cell: (row: Charter) => row.title },
            { id: "group", header: "Working group", cell: (row: Charter) => row.group },
            { id: "version", header: "Version", width: "fit" as const, cell: (row: Charter) => row.version },
            { id: "ratified", header: "Ratified", width: "fit" as const, cell: (row: Charter) => row.ratified },
          ]}
          rows={CHARTERS}
          rowKey={(row: Charter) => row.id}
        />
      </div>
    </div>
  );
}
