import { confirmAction } from "../../../../components/ConfirmDialog";
import { Toolbar } from "../../../../ui/Toolbar";
import { invalidateMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { MembershipCategoryForm } from "./MembershipCategoryForm";
/** Category catalog with separate create/edit pages and guarded deletion of unused entries. */
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  membershipCategoryCatalogResponseSchema,
  membershipCategoryDeleteSchema,
  membershipCategoryOrderSchema,
  membershipCategoryDeleteResponseSchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import { DataTable, type Column } from "../../../../components/Table";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { PageHeader } from "../../../../ui/PageHeader";
import { RowActions } from "../../../../ui/RowActions";
import { getJson, requestJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";
import "../../../../ui/Content.css";

const CATEGORIES_API = "/api/v1/membership/categories";
const CATEGORIES_PATH = "/settings/membership-categories";

function editPath(code: string): string {
  return `${CATEGORIES_PATH}/${encodeURIComponent(code)}`;
}

/** The catalog, read once; the edit page and the list share it. */
function useCategoryCatalog() {
  const [categories, setCategories] = useState<MembershipCategoryCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(CATEGORIES_API, membershipCategoryCatalogResponseSchema);
      setCategories(response.categories);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  return { categories, loading, error, load };
}

export function MembershipCategories({
  canWrite,
  categoryCode,
}: {
  canWrite: boolean;
  /** The code of the category whose edit page is open; undefined for the list. */
  categoryCode?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const { categories, loading, error, load } = useCategoryCatalog();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [reordering, setReordering] = useState(false);

  async function move(category: MembershipCategoryCatalogEntry, direction: -1 | 1) {
    if (!canWrite || reordering) return;
    const index = categories.findIndex((entry) => entry.code === category.code);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    const ordered = [...categories];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setReordering(true);
    setMutationError(null);
    try {
      await requestJson(`${CATEGORIES_API}/order`, membershipCategoryCatalogResponseSchema, {
        method: "PUT",
        body: JSON.stringify(
          membershipCategoryOrderSchema.parse({
            categories: ordered.map(({ code, revision }) => ({ code, expectedRevision: revision })),
          }),
        ),
      });
      invalidateMembershipCategoryCatalog();
      await load();
      toast(`Category ${category.code} moved ${direction < 0 ? "up" : "down"}`, "success");
    } catch (caught) {
      setMutationError((caught as Error).message);
    } finally {
      setReordering(false);
    }
  }

  async function remove(category: MembershipCategoryCatalogEntry) {
    if (
      !canWrite ||
      !(await confirmAction({
        title: `Delete ${category.label}?`,
        body: "Only unused categories can be deleted. The category's group eligibility rules will also be removed.",
        confirmLabel: "Delete category",
        cancelLabel: "Keep category",
      }))
    )
      return;
    setMutationError(null);
    try {
      await requestJson(
        `${CATEGORIES_API}/${encodeURIComponent(category.code)}`,
        membershipCategoryDeleteResponseSchema,
        {
          method: "DELETE",
          body: JSON.stringify(membershipCategoryDeleteSchema.parse({ expectedRevision: category.revision })),
        },
      );
      invalidateMembershipCategoryCatalog();
      toast(`Category ${category.code} deleted`, "success");
      await load();
    } catch (error) {
      setMutationError((error as Error).message);
    }
  }

  if (categoryCode === "new" && loading) return <Spinner label="Loading membership categories…" />;
  if (categoryCode === "new" && error) return <ErrorAlert error={error} />;
  if (categoryCode === "new")
    return (
      <MembershipCategoryForm
        canWrite={canWrite}
        nextDisplayOrder={Math.max(0, ...categories.map((entry) => entry.displayOrder)) + 10}
        onSaved={load}
      />
    );
  if (categoryCode !== undefined) {
    if (loading) return <Spinner label="Loading membership categories…" />;
    const category = categories.find((entry) => entry.code === categoryCode);
    if (error || !category) {
      return (
        <div class="pk pk-stack">
          <PageHeader
            trail={[
              { label: "Settings", href: usePortalHashLocation.hrefs("/settings") },
              { label: "Membership categories", href: usePortalHashLocation.hrefs(CATEGORIES_PATH) },
            ]}
            title="Membership category"
          />
          {error ? (
            <ErrorAlert error={error} />
          ) : (
            <EmptyState
              title={`There is no membership category with the code ${categoryCode}.`}
              action={{ label: "Back to membership categories", onSelect: () => navigate(CATEGORIES_PATH) }}
            />
          )}
        </div>
      );
    }
    // Keyed by revision so a save that comes back through the list starts a
    // fresh draft rather than editing on top of a stale one.
    return (
      <MembershipCategoryForm
        key={`${category.code}:${category.revision}`}
        category={category}
        canWrite={canWrite}
        onSaved={load}
      />
    );
  }

  const columns: Column<MembershipCategoryCatalogEntry>[] = [
    {
      header: "Code",
      cell: (category) => category.code,
      className: "pk-mono",
      width: "fit",
    },
    {
      header: "Category",
      cell: (category) => <strong>{category.label}</strong>,
    },
    {
      header: "Held by",
      cell: (category) => (
        <Badge tone="neutral" dot={false}>
          {category.isIndividual ? "Individual" : "Organization"}
        </Badge>
      ),
      width: "fit",
    },
    {
      header: "Voting",
      cell: (category) => (
        <Badge tone={category.isVoting ? "ok" : "neutral"}>{category.isVoting ? "Voting" : "Non-voting"}</Badge>
      ),
      width: "fit",
    },
    {
      // The one prose column, so the slack is its rather than the label's.
      header: "Description",
      width: "primary",
      cell: (category) =>
        category.description ? (
          <span class="pk-small">{category.description}</span>
        ) : (
          <span class="pk-muted pk-small">None</span>
        ),
    },
    ...(canWrite
      ? [
          {
            header: "",
            cell: (category: MembershipCategoryCatalogEntry) => (
              <RowActions
                subject={`category ${category.code}`}
                actions={[
                  {
                    id: "up",
                    label: "Move up",
                    disabled: reordering || categories[0]?.code === category.code,
                    onSelect: () => void move(category, -1),
                  },
                  {
                    id: "down",
                    label: "Move down",
                    disabled: reordering || categories.at(-1)?.code === category.code,
                    onSelect: () => void move(category, 1),
                  },
                  { id: "edit", label: "Edit…", onSelect: () => navigate(editPath(category.code)) },
                  { id: "delete", label: "Delete…", danger: true, onSelect: () => void remove(category) },
                ]}
              />
            ),
          } satisfies Column<MembershipCategoryCatalogEntry>,
        ]
      : []),
  ];

  return (
    <div class="pk pk-stack">
      <PageHeader title="Membership categories" />
      <p class="pk-small">
        Manage categories for organizations and individual users. Group eligibility is configured separately; categories
        already in use cannot be deleted.
      </p>
      <ErrorAlert error={mutationError} />
      {error ? (
        <ErrorAlert error={error} />
      ) : (
        <section class="pk-panel pk-table-list" aria-label="Membership categories">
          {canWrite && (
            <Toolbar label="Membership categories controls">
              <Button onClick={() => navigate(editPath("new"))}>New category</Button>
            </Toolbar>
          )}
          <DataTable
            caption="Membership categories"
            columns={columns}
            data={categories}
            loading={loading}
            empty="No membership categories are configured."
            rowKey={(category) => category.code}
            rowAction={
              canWrite
                ? (category) => ({
                    label: `Edit category ${category.code}`,
                    href: usePortalHashLocation.hrefs(editPath(category.code)),
                  })
                : undefined
            }
          />
        </section>
      )}
    </div>
  );
}
