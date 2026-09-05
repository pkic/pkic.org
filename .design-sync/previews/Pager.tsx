import { DataTable, Pager } from "pkic-org-events-backend";

/**
 * Pager closes a list panel: the range at the start, the page window in the
 * middle, rows-per-page at the end. It is shown under the rows it counts,
 * which is the only place the portal puts it.
 */
const noop = () => {};

interface Organization {
  id: string;
  name: string;
  country: string;
  membership: string;
}

const ORGANIZATIONS: Organization[] = [
  { id: "o1", name: "SecureTrust Authority", country: "Norway", membership: "Full member" },
  { id: "o2", name: "Northgate PKI Services", country: "United Kingdom", membership: "Full member" },
  { id: "o3", name: "QuantumRoot GmbH", country: "Germany", membership: "Associate" },
  { id: "o4", name: "CertNet Global", country: "Singapore", membership: "Full member" },
];

const columns = [
  { id: "name", header: "Organization", width: "primary" as const, cell: (row: Organization) => row.name },
  { id: "country", header: "Country", cell: (row: Organization) => row.country },
  { id: "membership", header: "Membership", width: "fit" as const, cell: (row: Organization) => row.membership },
];

/** The canonical placement: the pager as the last band of the list panel. */
export function UnderAMemberDirectory() {
  return (
    <div class="pk">
      <div class="pk-table-list">
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
          rangeEnd={25}
          onSelect={noop}
        />
      </div>
    </div>
  );
}

/**
 * The window: above seven pages the pager keeps the first, the last, the
 * current page and one neighbour either side, and elides the rest.
 */
export function DeepInTheAuditLog() {
  return (
    <div class="pk pk-stack">
      <span class="pk-small pk-muted">Audit log — page 9 of 24</span>
      <Pager
        label="Audit log pagination"
        page={9}
        pageCount={24}
        total={588}
        rangeStart={201}
        rangeEnd={225}
        onSelect={noop}
      />
      <span class="pk-small pk-muted">Certificate registry — page 1 of 5, no elision needed</span>
      <Pager
        label="Certificate registry pagination"
        page={1}
        pageCount={5}
        total={118}
        rangeStart={1}
        rangeEnd={25}
        onSelect={noop}
      />
    </div>
  );
}

/** How many rows a page holds lives with the page numbers, not beside them. */
export function WithRowsPerPage() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <DataTable
          caption="Certificate agreements"
          columns={columns}
          rows={ORGANIZATIONS}
          rowKey={(row: Organization) => row.id}
        />
        <Pager
          label="Certificate agreement pagination"
          page={3}
          pageCount={11}
          total={264}
          rangeStart={51}
          rangeEnd={75}
          onSelect={noop}
          pageSize={{ value: 25, options: [10, 25, 50, 100], onChange: noop }}
        />
      </div>
    </div>
  );
}

/**
 * One page of results: there is nothing to navigate to, so the window is
 * empty and both directions are disabled — the count still has to be said.
 */
export function OnlyOnePage() {
  return (
    <div class="pk">
      <div class="pk-table-list">
        <DataTable
          caption="Executive council"
          columns={columns}
          rows={ORGANIZATIONS.slice(0, 3)}
          rowKey={(row: Organization) => row.id}
        />
        <Pager
          label="Executive council pagination"
          page={1}
          pageCount={1}
          total={3}
          rangeStart={1}
          rangeEnd={3}
          onSelect={noop}
        />
      </div>
    </div>
  );
}
