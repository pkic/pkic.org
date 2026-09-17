/**
 * Membership → Applications. Staff review/transition membership
 * applications through the stage machine, send communications, add
 * internal notes, view uploaded documents, and record EC decisions.
 * List/detail split mirrors Users.tsx; list mirrors Members.tsx's use of
 * ApiDataTable.
 *
 * Split into feature components (PR #1 review, Phase 8) — see
 * useApplicationDetail and the Application*Card components in this
 * directory. This file is just the list/detail top-level composition.
 */
import { useLocation } from "wouter";
import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { PageHeader } from "../../../../ui/PageHeader";
import { ApplicationDetailView } from "./ApplicationDetailView";
import { ApplicationsList } from "./ApplicationsList";

export function MembershipApplications({
  initialApplicationId = null,
  initialTab,
  canWrite,
  canApprove,
}: {
  initialApplicationId?: string | null;
  /** The record's URL-addressed facet. */
  initialTab?: string;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const [, navigate] = useLocation();
  const categories = useMembershipCategoryCatalog();

  if (initialApplicationId) {
    return (
      <ApplicationDetailView
        applicationId={initialApplicationId}
        categories={categories}
        canWrite={canWrite}
        canApprove={canApprove}
        tab={initialTab}
      />
    );
  }
  return (
    <div class="pk pk-stack">
      <PageHeader title="Membership applications" />
      <ApplicationsList onViewApplication={(id) => navigate(`/membership/applications/${encodeURIComponent(id)}`)} />
    </div>
  );
}
