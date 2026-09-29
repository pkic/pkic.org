import { formatDateTime } from "../../shared/format-date";
import { Alert } from "../ui/Alert";
import { friendlyErrorMessage } from "./ErrorAlert";

export function RefreshNotice({ error, updatedAt }: { error: string | Error; updatedAt: string | null }) {
  return (
    <Alert tone="warn" title="Could not refresh">
      <p>{friendlyErrorMessage(error instanceof Error ? error.message : error)}</p>
      <p>
        {updatedAt
          ? `Showing information loaded ${formatDateTime(updatedAt)}.`
          : "Showing the previously loaded information."}
      </p>
    </Alert>
  );
}
