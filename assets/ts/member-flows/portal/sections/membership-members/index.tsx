import { useEffect } from "preact/hooks";
import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { usePortalHashLocation } from "../../hash-location";
import { GrantIndividualMembershipForm } from "./GrantIndividualMembershipForm";
import { MemberEditForm } from "./MemberEditForm";
import { MembersList } from "./MembersList";
import { PageHeader } from "../../../../ui/PageHeader";

/** Reserved members segment that routes to the grant page instead of a membership. */
const GRANT_MEMBERSHIP_SEGMENT = "grant";

const MEMBERS_PATH = "/members";

/** Redirects back to the roll from an effect, not render — see its call sites below. */
function MembersRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => navigate(MEMBERS_PATH), [navigate]);
  return null;
}

/**
 * Membership → Members: the consortium's own roll, the page a membership is
 * granted from, and the page one is edited on. Both are places with their own
 * address rather than panels that unfold above the table.
 *
 * A row is a membership, not a person. Membership belongs to an organization
 * or to an individual, and an organization's representatives inherit it
 * rather than each holding one of their own, so an organization with five
 * people is one member listed once.
 */
export function Members({
  canGrant,
  canWrite,
  memberSegment,
}: {
  /** `membership:write` plus `identities:activate`: a grant activates at once. */
  canGrant: boolean;
  /** `membership:write`: changing or ending a membership that already exists. */
  canWrite: boolean;
  /** `undefined` for the roll, `"grant"` for the grant page, a member id to edit one. */
  memberSegment?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const categories = useMembershipCategoryCatalog();

  function openGrantPage(): void {
    navigate(`${MEMBERS_PATH}/${GRANT_MEMBERSHIP_SEGMENT}`);
  }

  if (memberSegment === GRANT_MEMBERSHIP_SEGMENT) {
    // Navigating away belongs in an effect, not in render.
    if (!canGrant) return <MembersRedirect navigate={navigate} />;
    // The grant page supplies its own `pk` root, its heading, and its way
    // back, so nothing is wrapped around it here.
    return (
      <GrantIndividualMembershipForm
        categories={categories}
        onGranted={() => navigate(MEMBERS_PATH)}
        onCancel={() => navigate(MEMBERS_PATH)}
      />
    );
  }

  if (memberSegment) {
    if (!canWrite) return <MembersRedirect navigate={navigate} />;
    return (
      <MemberEditForm
        memberId={memberSegment}
        categories={categories}
        onSaved={() => navigate(MEMBERS_PATH)}
        onCancel={() => navigate(MEMBERS_PATH)}
      />
    );
  }

  return (
    <section class="pk pk-stack">
      <PageHeader title="Members" />
      <MembersList
        categories={categories}
        canWrite={canWrite}
        createAction={canGrant ? { label: "Grant membership", onSelect: openGrantPage } : undefined}
        onEditMember={(memberId) => navigate(`${MEMBERS_PATH}/${encodeURIComponent(memberId)}`)}
      />
    </section>
  );
}
