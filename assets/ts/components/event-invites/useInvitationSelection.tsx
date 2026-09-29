import { useState, type MutableRef } from "preact/hooks";
import type { EventInviteSummary } from "../../../shared/schemas/event-invites";
import { eventInviteResendResponseSchema } from "../../../shared/schemas/event-invites";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { postJson } from "../../shared/api-client";
import type { ApiTableActions } from "../ApiDataTable";
import { confirmAction } from "../ConfirmDialog";
import { BulkBar } from "../../ui/BulkBar";
import { Button } from "../../ui/Button";

type Invitation = Pick<EventInviteSummary, "id" | "inviteeEmail" | "actions">;
type Action = "resend" | "revoke";

/** Selection is limited to the loaded page; each invitation keeps its atomic lifecycle command. */
export function useInvitationSelection(
  endpoint: string,
  table: MutableRef<ApiTableActions | null>,
  report: (message: string) => void,
) {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const eligible = (action: Action) => rows.filter((row) => selected.has(row.id) && row.actions[action]);

  async function run(action: Action) {
    const targets = eligible(action);
    if (busy || !targets.length) return;
    const confirmed = await confirmAction({
      title: `${action === "resend" ? "Resend" : "Revoke"} ${targets.length} invitations?`,
      body:
        action === "resend"
          ? "Each recipient will receive a new invitation email using the event's default deadline."
          : "The selected invitation links will stop working immediately.",
      confirmLabel: action === "resend" ? "Resend invitations" : "Revoke invitations",
    });
    if (!confirmed) return;
    setBusy(true);
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const row of targets) {
        try {
          const path = `${endpoint}/${encodeURIComponent(row.id)}/${action}`;
          if (action === "resend") await postJson(path, {}, eventInviteResendResponseSchema);
          else await postJson(path, {}, successResponseSchema);
          completed++;
        } catch (error) {
          failures.push(
            `${row.inviteeEmail}: ${error instanceof Error ? error.message : "Unable to update invitation"}`,
          );
        }
      }
      await table.current?.reload();
      report(
        `${completed} of ${targets.length} invitations ${action === "resend" ? "resent" : "revoked"}.${failures.length ? ` Failed: ${failures.join("; ")}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    onData: (response: { invites: Invitation[] }) => {
      setRows(response.invites);
      setSelected(new Set());
    },
    selection: {
      selected,
      onChange: (next: ReadonlySet<string>) => {
        if (!busy) setSelected(next);
      },
      rowLabel: (id: string) => `Select invitation for ${rows.find((row) => row.id === id)?.inviteeEmail ?? id}`,
    },
    bulkBar: (
      <BulkBar
        count={selected.size}
        total={rows.length}
        onClear={() => {
          if (!busy) setSelected(new Set());
        }}
      >
        <Button size="sm" disabled={busy || eligible("resend").length === 0} onClick={() => void run("resend")}>
          Resend selected
        </Button>
        <Button
          size="sm"
          variant="danger-quiet"
          disabled={busy || eligible("revoke").length === 0}
          onClick={() => void run("revoke")}
        >
          Revoke selected
        </Button>
      </BulkBar>
    ),
  };
}
