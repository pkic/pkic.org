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
import { BulkBar } from "../../../../ui/BulkBar";
import { Button } from "../../../../ui/Button";
import { EditActions } from "../../../../ui/EditActions";
import { RowActions } from "../../../../ui/RowActions";
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
  const [savedRules, setSavedRules] = useState<RuleDraft[]>([]);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof loadCategories>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

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
        setSavedRules(draftFromResponse(response));
        setEditing(false);
        setSelected(new Set());
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
    setEditing(true);
    setSaved(false);
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
    if (!editing || saving) return;
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
      setSavedRules(rules);
      setEditing(false);
      setSelected(new Set());
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
        <PanelHeader id={headingId} title="Membership category eligibility">
          {categories.length > 0 && (
            <EditActions
              label="Eligibility actions"
              editing={editing}
              saving={saving}
              saveLabel="Save category rules"
              onEdit={() => {
                setError(null);
                setSaved(false);
                form.reset();
                setEditing(true);
              }}
              onCancel={() => {
                setRules(savedRules);
                setEditing(false);
                setSelected(new Set());
                setError(null);
                form.reset();
              }}
            />
          )}
        </PanelHeader>
        <div>
          {error && (
            <PanelBody>
              <ErrorAlert error={error} />
            </PanelBody>
          )}
          {categories.length > 0 && (
            <BulkBar count={selected.size} total={categories.length} onClear={() => setSelected(new Set())}>
              {(
                [
                  ["Allow joining", "permitsJoin", true],
                  ["Disallow joining", "permitsJoin", false],
                  ["Enable automatic enrollment", "automaticEnrollment", true],
                  ["Disable automatic enrollment", "automaticEnrollment", false],
                ] as const
              ).map(([label, field, value]) => (
                <Button
                  key={label}
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    for (const category of selected) updateRule(category, field, value);
                  }}
                >
                  {label}
                </Button>
              ))}
            </BulkBar>
          )}
          <DataTable
            caption="Membership category eligibility"
            rows={categories}
            rowKey={(category) => category.code}
            selection={{
              selected,
              onChange: setSelected,
              rowLabel: (code) => categories.find((category) => category.code === code)?.label ?? code,
            }}
            empty="No membership categories are configured."
            columns={[
              {
                id: "category",
                header: "Category",
                cell: (category) => <span class="pk-strong">{category.label}</span>,
              },
              {
                id: "join",
                header: "Join",
                cell: (category) => (rulesByCategory.get(category.code)?.permitsJoin ? "Allowed" : "Not allowed"),
              },
              {
                id: "automatic",
                header: "Automatic enrollment",
                cell: (category) => (rulesByCategory.get(category.code)?.automaticEnrollment ? "Enabled" : "Disabled"),
              },
              {
                id: "actions",
                header: "Actions",
                headerHidden: true,
                align: "end",
                cell: (category) => (
                  <RowActions
                    subject={category.label}
                    actions={[
                      {
                        id: "join",
                        label: rulesByCategory.get(category.code)?.permitsJoin ? "Disallow joining" : "Allow joining",
                        disabled: saving,
                        onSelect: () =>
                          updateRule(category.code, "permitsJoin", !rulesByCategory.get(category.code)?.permitsJoin),
                      },
                      {
                        id: "automatic",
                        label: rulesByCategory.get(category.code)?.automaticEnrollment
                          ? "Disable automatic enrollment"
                          : "Enable automatic enrollment",
                        disabled: saving,
                        onSelect: () =>
                          updateRule(
                            category.code,
                            "automaticEnrollment",
                            !rulesByCategory.get(category.code)?.automaticEnrollment,
                          ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          {saved && (
            <PanelBody>
              <Alert tone="ok">Membership category rules updated.</Alert>
            </PanelBody>
          )}
        </div>
      </Panel>
    </form>
  );
}

async function loadCategories() {
  const response = await getJson("/api/v1/members/applications/form", memberApplicationFormResponseSchema);
  return response.categories;
}
