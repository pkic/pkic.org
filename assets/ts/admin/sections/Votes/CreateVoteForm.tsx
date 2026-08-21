import { useState } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import { VOTE_TYPES, SCOPE_TYPES, thresholdOptionsFor } from "./shared";
import { performAdminAction } from "../../actions";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";
import { activeAdminWorkingGroupCatalog } from "../../services/catalogs";

interface CandidateDraft {
  name: string;
  bio: string;
}

interface CreateDraft {
  title: string;
  description: string;
  voteType: (typeof VOTE_TYPES)[number];
  scopeType: (typeof SCOPE_TYPES)[number];
  scopeId: string;
  thresholdType: string;
  opensAt: string;
  closesAt: string;
  candidates: CandidateDraft[];
}

function emptyDraft(): CreateDraft {
  return {
    title: "",
    description: "",
    voteType: "motion",
    scopeType: "forum",
    scopeId: "",
    thresholdType: "simple_majority",
    opensAt: "",
    closesAt: "",
    candidates: [
      { name: "", bio: "" },
      { name: "", bio: "" },
    ],
  };
}

export function CreateVoteForm({ onCreated }: { onCreated: () => void }) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [workingGroupLabel, setWorkingGroupLabel] = useState<string>();

  function patch(p: Partial<CreateDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!draft.closesAt) {
      toast("Closes-at is required", "error");
      return;
    }
    await performAdminAction({
      setBusy: setSaving,
      request: () =>
        api("/api/v1/admin/votes", {
          method: "POST",
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            voteType: draft.voteType,
            scopeType: draft.scopeType,
            scopeId: draft.scopeType === "working_group" ? draft.scopeId || undefined : undefined,
            thresholdType: draft.thresholdType,
            opensAt: draft.opensAt ? new Date(draft.opensAt).toISOString() : undefined,
            closesAt: new Date(draft.closesAt).toISOString(),
            candidates:
              draft.voteType === "election"
                ? draft.candidates
                    .filter((candidate) => candidate.name.trim())
                    .map((candidate) => ({
                      name: candidate.name.trim(),
                      bio: candidate.bio.trim() || undefined,
                    }))
                : undefined,
          }),
        }),
      successMessage: "Vote created",
      afterSuccess: () => {
        setDraft(emptyDraft());
        onCreated();
      },
    });
  }

  return (
    <form onSubmit={submit} class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-2">
          <div class="col-sm-6">
            <label class="form-label small">Title</label>
            <input
              class="form-control form-control-sm"
              value={draft.title}
              required
              onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label small">Description</label>
            <input
              class="form-control form-control-sm"
              value={draft.description}
              onInput={(e) => patch({ description: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Vote type</label>
            <select
              class="form-select form-select-sm"
              value={draft.voteType}
              onChange={(e) => {
                const voteType = (e.target as HTMLSelectElement).value as CreateDraft["voteType"];
                patch({ voteType, thresholdType: thresholdOptionsFor(voteType)[0].value });
              }}
            >
              {VOTE_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Scope</label>
            <select
              class="form-select form-select-sm"
              value={draft.scopeType}
              onChange={(e) => patch({ scopeType: (e.target as HTMLSelectElement).value as CreateDraft["scopeType"] })}
            >
              {SCOPE_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t === "forum" ? "Forum (one org/vote)" : "Working group"}
                </option>
              ))}
            </select>
          </div>
          {draft.scopeType === "working_group" && (
            <div class="col-sm-3">
              <ServerSearchSelect
                catalog={activeAdminWorkingGroupCatalog()}
                label="Working group"
                value={draft.scopeId}
                selectedLabel={workingGroupLabel}
                disabled={saving}
                onChange={(group) => {
                  patch({ scopeId: group?.id ?? "" });
                  setWorkingGroupLabel(group?.name);
                }}
              />
            </div>
          )}
          <div class="col-sm-3">
            <label class="form-label small">Threshold</label>
            <select
              class="form-select form-select-sm"
              value={draft.thresholdType}
              onChange={(e) => patch({ thresholdType: (e.target as HTMLSelectElement).value })}
            >
              {thresholdOptionsFor(draft.voteType).map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Opens at (blank = now)</label>
            <input
              type="datetime-local"
              class="form-control form-control-sm"
              value={draft.opensAt}
              onInput={(e) => patch({ opensAt: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Closes at</label>
            <input
              type="datetime-local"
              class="form-control form-control-sm"
              required
              value={draft.closesAt}
              onInput={(e) => patch({ closesAt: (e.target as HTMLInputElement).value })}
            />
          </div>

          {draft.voteType === "election" && (
            <div class="col-12">
              <label class="form-label small">Candidates</label>
              {draft.candidates.map((c, i) => (
                <div class="row g-2 mb-1" key={i}>
                  <div class="col-sm-4">
                    <input
                      class="form-control form-control-sm"
                      placeholder="Name"
                      value={c.name}
                      onInput={(e) => {
                        const next = [...draft.candidates];
                        next[i] = { ...next[i], name: (e.target as HTMLInputElement).value };
                        patch({ candidates: next });
                      }}
                    />
                  </div>
                  <div class="col-sm-6">
                    <input
                      class="form-control form-control-sm"
                      placeholder="Bio (optional)"
                      value={c.bio}
                      onInput={(e) => {
                        const next = [...draft.candidates];
                        next[i] = { ...next[i], bio: (e.target as HTMLInputElement).value };
                        patch({ candidates: next });
                      }}
                    />
                  </div>
                  <div class="col-sm-2">
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onClick={() => patch({ candidates: draft.candidates.filter((_, idx) => idx !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                onClick={() => patch({ candidates: [...draft.candidates, { name: "", bio: "" }] })}
              >
                + Add candidate
              </button>
            </div>
          )}
        </div>

        <button type="submit" class="btn btn-success btn-sm mt-3" disabled={saving}>
          Create vote
        </button>
      </div>
    </form>
  );
}
