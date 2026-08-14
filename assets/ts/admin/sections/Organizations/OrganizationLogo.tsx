/**
 * Organization logo upload/removal. Split out of Organizations.tsx (PR #1
 * review).
 */
import { useState, useRef } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminOrganizationDetail } from "../../types";

export function OrganizationLogo({ org, onChanged }: { org: AdminOrganizationDetail; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/organizations/${org.id}/logo`, {
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
    if (!confirm("Remove this organization's logo?")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/organizations/${org.id}/logo`, { method: "DELETE" });
      toast("Logo removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="text-center">
      {org.logoUrl ? (
        <img
          src={org.logoUrl}
          alt={`${org.name} logo`}
          class="img-fluid mb-2 border rounded p-2 bg-white"
          style="max-height: 160px;"
        />
      ) : (
        <div
          class="d-flex align-items-center justify-content-center mb-2 border rounded bg-light text-muted"
          style="height: 120px;"
        >
          No logo
        </div>
      )}
      <div class="d-flex gap-2 justify-content-center">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="form-control form-control-sm w-auto"
          disabled={busy}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {org.logoUrl && (
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
