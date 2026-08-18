import { useState, useRef } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import type { Sponsorship } from "../../types";

/**
 * Logo manager for non-member sponsors only (organizationId null) — mirrors
 * Organizations.tsx's OrganizationLogo. Org-tied sponsors show/manage their
 * logo via the organization itself, since that's what the public sponsor
 * list actually reads (organizations.logo_r2_key, GET /api/v1/members/:id/logo).
 */
export function SponsorshipLogo({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/sponsorships/${sponsorship.id}/logo`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      toast("Logo uploaded", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function remove() {
    if (!confirm("Remove this sponsor's logo?")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/sponsorships/${sponsorship.id}/logo`, { method: "DELETE" });
      toast("Logo removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="d-flex align-items-center gap-3 mb-3">
      {sponsorship.nonMemberLogoUrl ? (
        <img
          src={sponsorship.nonMemberLogoUrl}
          alt={`${sponsorship.nonMemberName ?? "Sponsor"} logo`}
          class="border rounded p-1 bg-white"
          style="max-height: 60px; max-width: 120px;"
        />
      ) : (
        <div
          class="d-flex align-items-center justify-content-center border rounded bg-light text-muted small"
          style="height: 60px; width: 120px;"
        >
          No logo
        </div>
      )}
      <div class="d-flex flex-column gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="form-control form-control-sm"
          disabled={busy}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {sponsorship.nonMemberLogoUrl && (
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            Remove logo
          </button>
        )}
      </div>
    </div>
  );
}
