import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  sessionHoldListSchema,
  sessionHoldRevokeSchema,
} from "../../../../../../../shared/schemas/event-session-holds";
import { getJson, deleteJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function SessionHolds({
  endpoint,
  onChanged,
  refreshKey = 0,
}: {
  endpoint: string;
  onChanged: () => void;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<z.infer<typeof sessionHoldListSchema>["items"]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  async function refresh(signal?: AbortSignal) {
    const result = await getJson(`${endpoint}/holds`, sessionHoldListSchema, { signal });
    setItems(result.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Holds are unavailable.");
    });
    return () => controller.abort();
  }, [endpoint, refreshKey]);
  async function release(id: string) {
    setBusy(id);
    setError("");
    try {
      const result = await deleteJson(`${endpoint}/holds/${id}`, sessionHoldRevokeSchema);
      setMessage(
        `Hold released. ${result.promoted} waitlisted registration${result.promoted === 1 ? "" : "s"} promoted.`,
      );
      await refresh();
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The hold could not be released.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section aria-label="Active capacity holds">
      <h3>Capacity holds</h3>
      <p>Holds count against capacity until their expiry or release. They do not grant admission.</p>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {item.reasonCode.replaceAll("_", " ")} · {item.attendanceMode === "physical" ? "In person" : "Remote"} ·
              expires {new Date(item.expiresAt).toLocaleString()}{" "}
              <Button
                type="button"
                loading={busy === item.id}
                disabled={Boolean(busy)}
                onClick={() => void release(item.id)}
              >
                Release hold
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No active holds.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <ErrorAlert error={error} />}
    </section>
  );
}
