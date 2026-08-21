import { api } from "../api";
import { toast } from "../ui";

interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: boolean;
}

export async function runGoogleGroupsSync(): Promise<void> {
  const result = await api<SyncResult>("/api/v1/admin/mailing-lists/sync", { method: "POST" });
  if (result.skippedUnconfigured) {
    toast("Google Groups sync isn't configured in this environment", "error");
  } else if (result.processed === 0) {
    toast("Nothing pending to sync", "success");
  } else {
    toast(
      `Synced ${result.processed}: ${result.succeeded} succeeded${result.failed ? `, ${result.failed} failed` : ""}`,
      result.failed > 0 ? "error" : "success",
    );
  }
}
