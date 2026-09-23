import {
  MEMBER_GROUP_LABELS,
  MEMBER_GROUPS,
  MEMBER_REPRESENTATION_LABELS,
  MEMBER_REPRESENTATION_STATES,
  memberUpdateResponseSchema,
  staffMembersListResponseSchema,
} from "../../../../../shared/schemas/members-directory";
import { MEMBER_STATUSES } from "../../../../../shared/schemas/membership-categories";
import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import type { StaffMemberSummary } from "../../../../../shared/schemas/members-directory";
import { useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { Badge, statusLabel } from "../../../../components/Badge";
import { IconIndividual, IconOrganization } from "../../../../components/icons";
// `pk-muted` and `pk-small` are written here as class names rather than
// reached through a component, so this module pulls their stylesheet into its
// own chunk.
import "../../../../ui/Content.css";
// `pk-table__clamp` is defined in the table's own stylesheet, which rides a
// lazy chunk: a surface that writes the class name pulls the sheet in itself.
import "../../../../ui/Table.css";
import { patchJson } from "../../../../shared/api-client";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { fmtDate, toast } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";
import { TableCodedLabel } from "../../../../ui/TableCodedLabel";

/**
 * Everyone the consortium counts as a member, one row each.
 *
 * A row is a membership, not a person: membership belongs to an organization
 * or to an individual, and an organization's representatives inherit it
 * rather than each holding one of their own. An organization with five people
 * is therefore one member, listed once, with five representatives named on it.
 */
export function MembersList({
  categories,
  canWrite,
  createAction,
  onEditMember,
}: {
  /** Reference data for the category filter's own options, not for the rows. */
  categories: readonly MembershipCategoryCatalogEntry[];
  canWrite: boolean;
  createAction?: { label: string; onSelect: () => void };
  onEditMember: (memberId: string) => void;
}) {
  const tableRef = useRef<ApiTableActions | null>(null);

  /**
   * Ending a membership is a standing, not a deletion: a member the
   * consortium once had is a fact its history keeps, and its representatives
   * lose what the membership gave them without losing their accounts.
   */
  async function setStatus(member: StaffMemberSummary, status: "active" | "inactive"): Promise<void> {
    const confirmed = await confirmAction(
      status === "inactive"
        ? {
            title: `End ${member.name}'s membership?`,
            consequences: [
              "The membership is recorded as ended rather than removed",
              member.memberType === "organization"
                ? "Its representatives keep their accounts and lose what the membership gave them"
                : "They keep their account and lose what the membership gave them",
            ],
            confirmLabel: "End membership",
          }
        : {
            title: `Reinstate ${member.name}'s membership?`,
            consequences: ["The membership stands again, under the category it already holds"],
            confirmLabel: "Reinstate membership",
            tone: "primary",
          },
    );
    if (!confirmed) return;
    try {
      await patchJson(`/api/v1/members/${encodeURIComponent(member.id)}`, { status }, memberUpdateResponseSchema);
      toast(status === "inactive" ? "Membership ended" : "Membership reinstated", "success");
      void tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }
  return (
    <ApiDataTable
      caption="Members"
      urlState="members"
      endpoint="/api/v1/members"
      // The staff projection, asked for rather than inferred from the reader's
      // permissions — which is what made a public page's shape depend on who
      // was looking (#11, #13, #25).
      params={{ view: "staff" }}
      responseSchema={staffMembersListResponseSchema}
      resolve={(data) => data.members}
      resolvePage={(data) => data.page}
      paginate
      initialSort="name"
      actionsRef={tableRef}
      searchPlaceholder="organization or name"
      createAction={createAction}
      columns={[
        {
          // The kind, as a mark rather than a word: it is one bit of
          // information repeated down every row, and spelling it out cost the
          // member's name the width it needed. Named, not decorative — it
          // stands in for the word rather than repeating one beside it.
          header: "Kind",
          cell: (member) =>
            member.memberType === "organization" ? (
              <IconOrganization aria-hidden={undefined} role="img" aria-label="Organization" />
            ) : (
              <IconIndividual aria-hidden={undefined} role="img" aria-label="Individual" />
            ),
          className: "pk-center",
          width: "fit",
          filter: {
            param: "group",
            // The kinds come from the query contract. `all` is that contract's
            // default rather than a kind, and the table drops an empty filter
            // instead of sending one, so it is offered as the empty value.
            options: [
              { value: "", label: MEMBER_GROUP_LABELS.all },
              ...MEMBER_GROUPS.filter((group) => group !== "all").map((group) => ({
                value: group,
                label: MEMBER_GROUP_LABELS[group],
              })),
            ],
          },
        },
        {
          // The slack column: a member's name is the identifying field and is
          // the one thing here of unbounded length, so the leftover width on a
          // wide screen belongs to it rather than to a fixed vocabulary.
          header: "Member",
          // The row leads with the member's mark — the organization's logo,
          // square, or the person's portrait, round — and initials while
          // there is none, as the users and organizations directories do.
          cell: (member) => (
            <PersonCell
              name={member.name}
              avatarSrc={member.imageUrl ?? undefined}
              shape={member.memberType === "organization" ? "square" : "round"}
              size="sm"
            />
          ),
          width: "primary",
          sort: { asc: "name", desc: "-name" },
        },
        {
          // How many people act for this one membership: an organization's
          // representatives inherit it rather than each holding their own.
          // "People" rather than "Representatives": the column holds single
          // digits, and the longer word sized it four times wider than its
          // widest value.
          header: "People",
          cell: (member) => member.representativeCount,
          className: "pk-center",
          width: "fit",
          sort: { asc: "representativeCount", desc: "-representativeCount" },
          // An organization with nobody acting for it is the case worth
          // finding: its membership lapses after a grace period, and until
          // then nothing reaches anybody.
          filter: {
            param: "representatives",
            options: [
              { value: "", label: "Any number" },
              ...MEMBER_REPRESENTATION_STATES.map((state) => ({
                value: state,
                label: MEMBER_REPRESENTATION_LABELS[state],
              })),
            ],
          },
        },
        {
          // The label is resolved where the category lives rather than joined
          // to a catalog here: a table presents rows, it does not assemble
          // them.
          header: "Category",
          cell: (member) => (
            // One line: the label is a fixed vocabulary the reader scans
            // rather than reads, and left to wrap it sets the height of every
            // row. The full text is the cell's tooltip.
            <TableCodedLabel
              code={member.membershipCategory}
              name={member.membershipCategoryLabel}
              title={member.membershipCategoryLabel}
            />
          ),
          width: "compact",
          sort: { asc: "membershipCategory", desc: "-membershipCategory" },
          filter: {
            param: "membershipCategory",
            options: [
              { value: "", label: "All categories" },
              ...categories.map((entry) => ({ value: entry.code, label: `${entry.label} (${entry.code})` })),
            ],
          },
        },
        {
          header: "Status",
          cell: (member) => <Badge status={member.status} />,
          width: "fit",
          sort: { asc: "status", desc: "-status" },
          filter: {
            param: "status",
            options: [
              { value: "", label: "All statuses" },
              ...MEMBER_STATUSES.map((status) => ({ value: status as string, label: statusLabel(status) })),
            ],
          },
        },
        {
          header: "Member since",
          cell: (member) => fmtDate(member.memberSince),
          width: "fit",
          sort: { asc: "memberSince", desc: "-memberSince", defaultDirection: "desc" },
        },
        {
          // What can be done to this membership, at the end of the row it
          // belongs to. Reading it opens the record that holds it; changing
          // and ending it are the membership's own commands.
          header: "",
          cell: (member) => (
            <RowActions
              subject={member.name}
              actions={
                canWrite
                  ? [
                      {
                        id: "edit",
                        label: "Edit membership",
                        onSelect: () => onEditMember(member.id),
                      },
                      member.status === "active"
                        ? { id: "end", label: "End membership", onSelect: () => void setStatus(member, "inactive") }
                        : {
                            id: "reinstate",
                            label: "Reinstate membership",
                            onSelect: () => void setStatus(member, "active"),
                          },
                    ]
                  : []
              }
            />
          ),
        },
      ]}
      empty="No memberships have been granted yet"
      rowKey={(member) => member.id}
      rowAction={(member) => ({
        label: `Open the record for ${member.name}`,
        // A membership's record is the thing that holds it: the organization
        // for an organization member, the person for an individual one.
        href: usePortalHashLocation.hrefs(
          member.organizationId
            ? `/organizations/${encodeURIComponent(member.organizationId)}`
            : `/users/${encodeURIComponent(member.userId ?? "")}`,
        ),
      })}
    />
  );
}
