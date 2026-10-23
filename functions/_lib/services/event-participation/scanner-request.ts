import { scanActionCapability } from "../../../../assets/shared/event-scanner-permissions";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike, Env } from "../../types";
import { prepareEventAdminContext, readEventAdminContext } from "../events/authorized-context";
import { guardScannerUploadAuthority, requireScannerCapability } from "./scanner-authorization";
import { prepareScannerAttemptBasis } from "./scanner-attempt-basis";
import { prepareScannerUploadReceipt, receiveScannerUpload } from "./scanner-upload-receipts";
import { recordScan } from "./scanning";
import { captureSponsorLead, sponsorLeadInput, prepareSponsorLeadBasis } from "./sponsor-leads";
import { requirePermission } from "../../auth/permissions";

/** Human sessions share one preflight batch; new captures retain a separate atomic command. */
export async function recordScannerUploadRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  scan: EventScanRequest,
) {
  const contextRead = await prepareEventAdminContext(db, request, env, eventSlug);
  const fallback = contextRead ? null : await readEventAdminContext(db, request, env, eventSlug);
  const selection = fallback ? fallback.event.id : { slug: eventSlug };
  const input = scan.action === "lead" ? sponsorLeadInput(scan) : null;
  const [receipt, basis] = await Promise.all([
    prepareScannerUploadReceipt(db, selection, scan),
    input
      ? prepareSponsorLeadBasis(db, selection, scan.sponsorId!, input).then((read) => ({
          type: "lead" as const,
          input,
          read,
        }))
      : prepareScannerAttemptBasis(db, selection, scan).then((read) => ({ type: "attendance" as const, read })),
  ]);
  const loaded = await db.batch([...(contextRead?.statements ?? []), receipt.statement, ...basis.read.statements]);
  const offset = contextRead?.statements.length ?? 0;
  const { actor, event } = contextRead ? await contextRead.decode(loaded.slice(0, offset)) : fallback!;
  if (basis.type === "lead") {
    const context = { type: "event_sponsor", id: scan.sponsorId! };
    requirePermission(actor, "agenda:leads_capture", context);
    const authority = guardScannerUploadAuthority(db, actor, context, "agenda:leads_capture", scan);
    return receiveScannerUpload(
      authority.db,
      event.id,
      scan,
      (uploadDb) =>
        captureSponsorLead(
          uploadDb,
          event.id,
          scan.sponsorId!,
          actor.id,
          basis.input,
          basis.read.decode(loaded.slice(offset + 1), event.id),
        ),
      loaded[offset],
    );
  }
  const { context, permission } = requireScannerCapability(actor, event.id, scanActionCapability(scan.action));
  const authority = guardScannerUploadAuthority(db, actor, context, permission, scan);
  return receiveScannerUpload(
    authority.db,
    event.id,
    scan,
    (uploadDb) =>
      recordScan(
        uploadDb,
        event.id,
        { operatorUserId: actor.id, canScan: true, canAdmitExceptions: authority.canAdmitExceptions },
        scan,
        basis.read.decode(loaded.slice(offset + 1), event.id),
      ),
    loaded[offset],
  );
}
