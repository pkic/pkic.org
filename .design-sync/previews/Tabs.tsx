import { Badge, PageHeader, Tabs } from "pkic-org-events-backend";

/**
 * Tabs is navigation: every tab is a real link to a URL and the current one
 * carries aria-current="page". The axis that varies here is which tab is
 * current, plus the header it normally sits under.
 */

const groupSections = [
  { id: "overview", label: "Overview", href: "/portal/groups/pqc" },
  { id: "members", label: "Members", href: "/portal/groups/pqc/members" },
  { id: "meetings", label: "Meetings", href: "/portal/groups/pqc/meetings" },
  { id: "documents", label: "Documents", href: "/portal/groups/pqc/documents" },
];

export function GroupSections() {
  return (
    <div class="pk">
      <Tabs items={groupSections} activeId="overview" label="Working group sections" />
    </div>
  );
}

export function CurrentTabFurtherAlong() {
  return (
    <div class="pk">
      <Tabs items={groupSections} activeId="meetings" label="Working group sections" />
    </div>
  );
}

export function UnderAPageHeader() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <PageHeader
        title="Entrust"
        context={
          <Badge tone="ok" dot>
            Member in good standing
          </Badge>
        }
        description="Membership agreement signed 4 March 2024, renewing annually."
      />
      <Tabs
        items={[
          { id: "profile", label: "Profile", href: "/portal/organizations/entrust" },
          { id: "people", label: "People", href: "/portal/organizations/entrust/people" },
          { id: "agreements", label: "Agreements", href: "/portal/organizations/entrust/agreements" },
          { id: "invoices", label: "Invoices", href: "/portal/organizations/entrust/invoices" },
        ]}
        activeId="agreements"
        label="Organization record sections"
      />
      <p class="pk-small pk-muted">Two agreements on file. The 2026 renewal is awaiting signature.</p>
    </div>
  );
}
