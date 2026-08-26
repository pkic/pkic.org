import { useEffect, useMemo, useState } from "preact/hooks";
import {
  groupCategoryRulesResponseSchema,
  groupResponseSchema,
  type GroupCategoryRule,
  type GroupCategoryRulesReplaceInput,
  type GroupCategoryRulesResponse,
} from "../../../../../shared/schemas/groups";
import { memberApplicationFormResponseSchema } from "../../../../../shared/schemas/member-applications";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { ApiClientError, getJson, putJson } from "../../../../shared/api-client";

type RuleDraft = Omit<GroupCategoryRule, "groupId">;

function draftFromResponse(response: GroupCategoryRulesResponse): RuleDraft[] {
  return response.rules.map(({ membershipCategory, permitsJoin, automaticEnrollment }) => ({
    membershipCategory,
    permitsJoin,
    automaticEnrollment,
  }));
}

/** Manager-only editor for the category policy; the category labels remain D1-backed reference data. */
export function GroupCategoryRulesEditor({ groupId, onUpdated }: { groupId: string; onUpdated: () => Promise<void> }) {
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [revision, setRevision] = useState(0);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof loadCategories>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/category-rules`, groupCategoryRulesResponseSchema),
      loadCategories(),
    ])
      .then(([response, categoryCatalog]) => {
        if (cancelled) return;
        setRevision(response.revision);
        setRules(draftFromResponse(response));
        setCategories(categoryCatalog);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiClientError ? cause.message : "Could not load category rules.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const rulesByCategory = useMemo(() => new Map(rules.map((rule) => [rule.membershipCategory, rule])), [rules]);

  function updateRule(category: string, field: "permitsJoin" | "automaticEnrollment", value: boolean): void {
    setRules((current) => {
      const existing = current.find((rule) => rule.membershipCategory === category) ?? {
        membershipCategory: category,
        permitsJoin: false,
        automaticEnrollment: false,
      };
      const next = { ...existing, [field]: value };
      const without = current.filter((rule) => rule.membershipCategory !== category);
      return next.permitsJoin || next.automaticEnrollment ? [...without, next] : without;
    });
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const input: GroupCategoryRulesReplaceInput = { expectedRevision: revision, rules };
      const response = await putJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/category-rules`,
        input,
        groupResponseSchema,
      );
      setRevision(response.group.revision);
      await onUpdated();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not update category rules.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  return (
    <form class="card border-0 shadow-sm" onSubmit={submit}>
      <div class="card-header bg-white fw-semibold">Membership category eligibility</div>
      <div class="card-body">
        <p class="text-muted small">
          Choose which active membership categories may join this group and which are enrolled automatically.
        </p>
        {error && <ErrorAlert error={error} />}
        {categories.length === 0 && <p class="text-muted mb-0">No membership categories are configured.</p>}
        {categories.length > 0 && (
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Join</th>
                  <th>Automatic enrollment</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const rule = rulesByCategory.get(category.code);
                  return (
                    <tr key={category.code}>
                      <th scope="row">
                        <span class="fw-semibold">{category.label}</span>
                        <div class="small text-muted">{category.code}</div>
                      </th>
                      <td>
                        <input
                          class="form-check-input"
                          type="checkbox"
                          aria-label={`${category.label} may join`}
                          checked={rule?.permitsJoin ?? false}
                          disabled={saving}
                          onChange={(event) =>
                            updateRule(category.code, "permitsJoin", (event.target as HTMLInputElement).checked)
                          }
                        />
                      </td>
                      <td>
                        <input
                          class="form-check-input"
                          type="checkbox"
                          aria-label={`${category.label} automatic enrollment`}
                          checked={rule?.automaticEnrollment ?? false}
                          disabled={saving}
                          onChange={(event) =>
                            updateRule(category.code, "automaticEnrollment", (event.target as HTMLInputElement).checked)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {saved && <div class="alert alert-success">Membership category rules updated.</div>}
        <button type="submit" class="btn btn-success" disabled={saving || (!!error && categories.length === 0)}>
          {saving ? "Saving…" : "Save category rules"}
        </button>
      </div>
    </form>
  );
}

async function loadCategories() {
  const response = await getJson("/api/v1/members/applications/form", memberApplicationFormResponseSchema);
  return response.categories;
}
