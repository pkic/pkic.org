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
import { useState } from "preact/hooks";
import { ApplicationDetailView } from "./ApplicationDetailView";
import { ApplicationsList } from "./ApplicationsList";

export function Applications({
  initialApplicationId = null,
  onBackFromInitial,
}: {
  initialApplicationId?: string | null;
  onBackFromInitial?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialApplicationId);

  if (selectedId) {
    return (
      <ApplicationDetailView
        applicationId={selectedId}
        onBack={() => {
          setSelectedId(null);
          if (selectedId === initialApplicationId) onBackFromInitial?.();
        }}
      />
    );
  }
  return <ApplicationsList onViewApplication={(id) => setSelectedId(id)} />;
}
