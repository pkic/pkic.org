import { useEffect, useRef, useState } from "preact/hooks";
import { portalSession } from "../../../../state";
import { BadgeCollectionPrinter } from "./BadgeCollectionPrinter";
import type { ScannerStatus } from "./ScannerStatus";

/** Keep a print job and its feedback inside the held badge's collection task. */
export function useBadgeCollectionPrinting(slug: string, enabled: boolean, online: boolean) {
  const [request, setRequest] = useState<{ id: string; credential: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const session = enabled ? portalSession.value : null;
  const previousSession = useRef(session);
  const available = Boolean(session && online);
  useEffect(() => {
    if (previousSession.current === session) return;
    previousSession.current = session;
    clear();
  }, [session]);
  function print(credential: string) {
    if (!available) return;
    setBusy(true);
    setStatus({
      key: `print:${credential}:start`,
      tone: "unverified",
      title: "Preparing badge for printing…",
      record: false,
    });
    setRequest({ id: crypto.randomUUID(), credential });
  }
  function clear() {
    setRequest(null);
    setStatus(null);
    setBusy(false);
  }
  const job =
    request && session ? (
      <BadgeCollectionPrinter
        key={request.id}
        slug={slug}
        session={session}
        credential={request.credential}
        onStatus={setStatus}
        onBusy={setBusy}
      />
    ) : null;
  return { available, active: Boolean(request), busy, status, print, clear, job };
}
