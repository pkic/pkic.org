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
import { Tabs } from "../../../../components/Tabs";
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
  const categories = useMembershipCategoryCatalog();

  const scope = initialApplicationId === "history" ? "history" : "active";
  if (initialApplicationId && initialApplicationId !== "history") {
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
      <PageHeader title={scope === "active" ? "Active applications" : "Application history"} />
      <Tabs
        label="Application views"
        items={[
          { key: "active", label: "Active applications" },
          { key: "history", label: "Application history" },
        ]}
        active={scope}
        hrefFor={(key) => (key === "active" ? "/membership/applications" : "/membership/applications/history")}
      />
      <ApplicationsList key={scope} scope={scope} />
    </div>
  );
}
