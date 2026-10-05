import {
  eventScanResponseSchema,
  type EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { scannerUploadStatusMessageSchema } from "../../../../../../../shared/schemas/event-scan-upload-status";
import { receiptMatchesOperation } from "./scan-stream";

export function scannerWorkerMessageListener(callbacks: {
  currentOperation(): string | null;
  authorityPaused(): boolean;
  setResult(receipt: EventScanResponse): void;
  refreshPending(): void;
  syncCurrentOperator(): void;
}) {
  return (event: MessageEvent<unknown>) => {
    if (scannerUploadStatusMessageSchema.safeParse(event.data).success) {
      // A worker drains across operators. Only our own scoped upload may decide
      // authority or pending counts; this message is an advisory wake-up.
      callbacks.syncCurrentOperator();
      return;
    }
    const receipt = eventScanResponseSchema.safeParse(event.data);
    if (!receipt.success) return;
    if (!callbacks.authorityPaused() && receiptMatchesOperation(receipt.data.operationId, callbacks.currentOperation()))
      callbacks.setResult(receipt.data);
    callbacks.refreshPending();
  };
}
