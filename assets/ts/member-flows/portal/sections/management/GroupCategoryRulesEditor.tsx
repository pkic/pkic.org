import { useEffect, useId, useMemo, useState } from "preact/hooks";
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
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { DataTable } from "../../../../ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import "../../../../ui/Content.css";

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
  const headingId = useId();
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
    <form class="pk" onSubmit={submit}>
      <Panel aria-labelledby={headingId}>
        <PanelHeader id={headingId} title="Membership category eligibility" />
        <PanelBody class="pk-stack">
          <p class="pk-small">
            Choose which active membership categories may join this group and which are enrolled automatically.
          </p>
          {error && <ErrorAlert error={error} />}
          {/* Two checkboxes per category, each named after the category it
              belongs to, so a reader moving through the grid always knows
              which row they are in without a visible row header. */}
          <DataTable
            caption="Membership category eligibility"
            rows={categories}
            rowKey={(category) => category.code}
            empty="No membership categories are configured."
            columns={[
              {
                id: "category",
                header: "Category",
                cell: (category) => (
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-strong">{category.label}</span>
                    <span class="pk-small pk-mono">{category.code}</span>
                  </div>
                ),
              },
              {
                id: "join",
                header: "Join",
                // The name is real label text, hidden because the row and
                // column headers already carry it visually, so a reader moving
                // through the grid still hears which category a box belongs to.
                cell: (category) => (
                  <Checkbox
                    checked={rulesByCategory.get(category.code)?.permitsJoin ?? false}
                    disabled={saving}
                    onChange={(event) =>
                      updateRule(category.code, "permitsJoin", (event.target as HTMLInputElement).checked)
                    }
                    label={<span class="pk-sr-only">{`${category.label} may join`}</span>}
                  />
                ),
              },
              {
                id: "automatic",
                header: "Automatic enrollment",
                cell: (category) => (
                  <Checkbox
                    checked={rulesByCategory.get(category.code)?.automaticEnrollment ?? false}
                    disabled={saving}
                    onChange={(event) =>
                      updateRule(category.code, "automaticEnrollment", (event.target as HTMLInputElement).checked)
                    }
                    label={<span class="pk-sr-only">{`${category.label} automatic enrollment`}</span>}
                  />
                ),
              },
            ]}
          />
          {saved && <Alert tone="ok">Membership category rules updated.</Alert>}
          <div class="pk-cluster">
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={saving || (!!error && categories.length === 0)}
            >
              {saving ? "Saving…" : "Save category rules"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}

async function loadCategories() {
  const response = await getJson("/api/v1/members/applications/form", memberApplicationFormResponseSchema);
  return response.categories;
}
