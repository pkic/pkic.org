import { useEffect, useId, useMemo, useState } from "preact/hooks";
import {
  groupCategoryRulesReplaceSchema,
  groupCategoryRulesResponseSchema,
  groupResponseSchema,
  type GroupCategoryRule,
  type GroupCategoryRulesResponse,
} from "../../../../../shared/schemas/groups";
import { memberApplicationFormResponseSchema } from "../../../../../shared/schemas/member-applications";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
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

  /*
   * One basis for validation: the contract the route parses. The body was
   * typed but never parsed, so a rule the schema refuses reached the server
   * and came back as one message for the whole editor.
   */
  const form = useContractForm(groupCategoryRulesReplaceSchema, { expectedRevision: revision, rules });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      const response = await putJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/category-rules`,
        checked.data,
        groupResponseSchema,
      );
      setRevision(response.group.revision);
      await onUpdated();
      setSaved(true);
    } catch (cause) {
      // A server refusal names its fields the way the contract does.
      setError(cause instanceof ApiClientError ? form.refuse(cause) : "Could not update category rules.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  return (
    <form noValidate class="pk" {...form.handlers} onSubmit={submit}>
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
