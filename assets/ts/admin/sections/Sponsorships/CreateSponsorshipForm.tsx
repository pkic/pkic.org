import { useState } from "preact/hooks";
import { api } from "../../api";
import { SPONSOR_TYPES, sponsorshipResponseSchema } from "../../../../shared/schemas/admin-sponsorships";
import { performAdminAction } from "../../actions";

interface CreateDraft {
  sponsorType: (typeof SPONSOR_TYPES)[number];
  organizationId: string;
  eventId: string;
  nonMemberName: string;
  contactName: string;
  contactEmail: string;
  tier: string;
}

function emptyCreateDraft(): CreateDraft {
  return {
    sponsorType: "consortium",
    organizationId: "",
    eventId: "",
    nonMemberName: "",
    contactName: "",
    contactEmail: "",
    tier: "",
  };
}

export function CreateSponsorshipForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<CreateDraft>(emptyCreateDraft());
  const [saving, setSaving] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    await performAdminAction({
      setBusy: setSaving,
      request: () =>
        api("/api/v1/admin/sponsorships", sponsorshipResponseSchema, {
          method: "POST",
          body: JSON.stringify({
            sponsorType: draft.sponsorType,
            organizationId: draft.organizationId.trim() || null,
            eventId: draft.eventId.trim() || null,
            nonMemberName: draft.nonMemberName.trim() || null,
            contactName: draft.contactName.trim() || null,
            contactEmail: draft.contactEmail.trim() || null,
            tier: draft.tier.trim() || null,
          }),
        }),
      successMessage: "Sponsorship created",
      afterSuccess: onCreated,
    });
  }

  return (
    <form onSubmit={submit} class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-2">
          <div class="col-sm-2">
            <label class="form-label small">Type</label>
            <select
              class="form-select form-select-sm"
              value={draft.sponsorType}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  sponsorType: (e.target as HTMLSelectElement).value as CreateDraft["sponsorType"],
                }))
              }
            >
              {SPONSOR_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {draft.sponsorType === "consortium" ? (
            <div class="col-sm-3">
              <label class="form-label small">Organization ID</label>
              <input
                class="form-control form-control-sm"
                value={draft.organizationId}
                onInput={(e) => setDraft((d) => ({ ...d, organizationId: (e.target as HTMLInputElement).value }))}
                required
              />
            </div>
          ) : (
            <>
              <div class="col-sm-3">
                <label class="form-label small">Event ID</label>
                <input
                  class="form-control form-control-sm"
                  value={draft.eventId}
                  onInput={(e) => setDraft((d) => ({ ...d, eventId: (e.target as HTMLInputElement).value }))}
                />
              </div>
              <div class="col-sm-2">
                <label class="form-label small">Non-member name</label>
                <input
                  class="form-control form-control-sm"
                  value={draft.nonMemberName}
                  onInput={(e) => setDraft((d) => ({ ...d, nonMemberName: (e.target as HTMLInputElement).value }))}
                />
              </div>
            </>
          )}
          <div class="col-sm-2">
            <label class="form-label small">Tier</label>
            <input
              class="form-control form-control-sm"
              value={draft.tier}
              onInput={(e) => setDraft((d) => ({ ...d, tier: (e.target as HTMLInputElement).value }))}
            />
          </div>
          <div class="col-sm-2">
            <label class="form-label small">Contact name</label>
            <input
              class="form-control form-control-sm"
              value={draft.contactName}
              onInput={(e) => setDraft((d) => ({ ...d, contactName: (e.target as HTMLInputElement).value }))}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Contact email</label>
            <input
              type="email"
              class="form-control form-control-sm"
              value={draft.contactEmail}
              onInput={(e) => setDraft((d) => ({ ...d, contactEmail: (e.target as HTMLInputElement).value }))}
            />
          </div>
        </div>
        <div class="mt-2 d-flex gap-2">
          <button type="submit" class="btn btn-success btn-sm" disabled={saving}>
            Create
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
