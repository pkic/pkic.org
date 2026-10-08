import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
/** Business outcomes are distinct from proof that the original operation was durably received. */
export function scannerReceiptMatches(receipt: EventScanResponse, scan: EventScanRequest): boolean {
  return Boolean(
    scan.scannerSession &&
    receipt.scannerReceipt &&
    receipt.operationId === scan.operationId &&
    receipt.scannerReceipt.operationId === scan.operationId &&
    receipt.scannerReceipt.epochId === scan.scannerSession.epochId &&
    receipt.scannerReceipt.sequence === scan.scannerSession.sequence,
  );
}
