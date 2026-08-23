import { api } from "../api";
import { toast } from "../ui";
import { mailingListSyncResponseSchema } from "../../../shared/schemas/admin-mailing-lists";

export async function runGoogleGroupsSync(): Promise<void> {
  const result = await api("/api/v1/admin/mailing-lists/sync", mailingListSyncResponseSchema, { method: "POST" });
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
