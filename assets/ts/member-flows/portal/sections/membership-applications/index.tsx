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
import { useEffect, useState } from "preact/hooks";
import { useLocation } from "wouter";
import {
  membershipCategoryCatalogResponseSchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import { getJson } from "../../../../shared/api-client";
import { ApplicationDetailView } from "./ApplicationDetailView";
import { ApplicationsList } from "./ApplicationsList";

export function MembershipApplications({
  initialApplicationId = null,
  canWrite,
  canApprove,
}: {
  initialApplicationId?: string | null;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const [, navigate] = useLocation();
  const [categories, setCategories] = useState<MembershipCategoryCatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getJson("/api/v1/system/membership-categories", membershipCategoryCatalogResponseSchema)
      .then((response) => {
        if (!cancelled) setCategories(response.categories);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (initialApplicationId) {
    return (
      <ApplicationDetailView
        applicationId={initialApplicationId}
        categories={categories}
        canWrite={canWrite}
        canApprove={canApprove}
        onBack={() => navigate("/system/membership-applications")}
      />
    );
  }
  return (
    <ApplicationsList
      onViewApplication={(id) => navigate(`/system/membership-applications/${encodeURIComponent(id)}`)}
    />
  );
}
