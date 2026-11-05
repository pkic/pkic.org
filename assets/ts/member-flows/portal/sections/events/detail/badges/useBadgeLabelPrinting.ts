import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeLabelRequestSchema,
  badgePrintResponseSchema,
  badgePrintingResponseSchema,
  type BadgePrintingContext,
  type BadgeLabelRequest,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { BADGE_LABEL_PRINTING_CONTEXT, BROTHER_DK_1208_PAPER } from "../../../../../../../shared/badge-label-policy";
import type { BadgePrintDesign } from "../../../../../../../shared/schemas/event-badge-template";
import { badgeFaceLayout, badgePrintPreset } from "../../../../../../../shared/badge-print-layout";
import { badgePrintLayoutSchema, type BadgePrintLayout } from "../../../../../../../shared/schemas/badge-print-layout";
import { badgePrintHtml } from "../../../../../../components/event-badges/badge-print-artifacts";
import { printBadgeDocument } from "../../../../../../components/event-badges/badge-print-command";
import { getJson, requestJson } from "../../../../../../shared/api-client";
import { isAuthed, portalSession } from "../../../../state";
import type { PortalSession } from "../../../../types";

type Label = z.infer<typeof badgePrintResponseSchema>;
interface PrintJob {
  key: string;
  label: Label;
  copies: number;
  design: BadgePrintDesign;
  sides: BadgePrintLayout["sides"];
  printing: BadgePrintingContext;
}

/** Transient print documents. Issuance retries reuse their operation; each print reads current authorized details. */
export function useBadgeLabelPrinting(
  slug: string,
  session: PortalSession,
  copies: number,
  design: BadgePrintDesign,
  sides: BadgePrintLayout["sides"],
  resume: () => void,
  format: "html" | "pdf" = "html",
) {
  const requestScope = useMemo(() => ({ slug, session, controller: new AbortController() }), [slug, session]);
  const controller = requestScope.controller;
  const artwork = useRef<Promise<BadgePrintingContext> | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const printOwner = useRef(new AbortController());
  const running = useRef(false);
  const lastScanned = useRef("");
  const issueOperations = useRef(new Map<string, string>());
  const printed = useRef<string | null>(null);
  const afterPrint = useRef<(() => void) | null>(null);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges`;
  const latestResume = useRef(resume);
  latestResume.current = resume;
  useEffect(() => {
    const operations = issueOperations.current;
    running.current = false;
    lastScanned.current = "";
    printed.current = null;
    setJob(null);
    setBusy(false);
    setError("");
    setMessage("");
    return () => {
      controller.abort();
      printOwner.current.abort();
      artwork.current = null;
      afterPrint.current?.();
      operations.clear();
    };
  }, [controller]);
  useEffect(() => {
    lastScanned.current = "";
  }, [design, copies, sides, format]);
  function current() {
    return (
      !controller.signal.aborted &&
      isAuthed.value &&
      portalSession.value === session &&
      Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now()
    );
  }
  function requireCurrent() {
    if (!current()) throw new Error("Sign in again to print badges.");
  }
  function loadArtwork() {
    requireCurrent();
    if (artwork.current) return artwork.current;
    const pending = getJson(`${endpoint}/printing`, badgePrintingResponseSchema, { signal: controller.signal })
      .then((context) => {
        requireCurrent();
        if (!context.template) throw new Error("No full badge artwork is configured for this event.");
        return context;
      })
      .catch((cause: unknown) => {
        if (artwork.current === pending) artwork.current = null;
        throw cause;
      });
    artwork.current = pending;
    return pending;
  }
  const artworkActions = useRef({ current, loadArtwork });
  artworkActions.current = { current, loadArtwork };
  useEffect(() => {
    let selected = true;
    setError("");
    if (design === "event_badge" && artworkActions.current.current())
      void artworkActions.current.loadArtwork().catch((cause: unknown) => {
        if (selected && artworkActions.current.current())
          setError(cause instanceof Error ? cause.message : "Could not load badge artwork.");
      });
    else artwork.current = null;
    return () => {
      selected = false;
    };
  }, [design, controller]);
  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return requestJson(path, schema, { method: "POST", body: JSON.stringify(body), signal: controller.signal });
  }
  async function load(target: BadgeLabelRequest | { userId: string }) {
    if (running.current || !current()) return;
    running.current = true;
    setBusy(true);
    printOwner.current.abort();
    printOwner.current = new AbortController();
    setPdf(null);
    setError("");
    setMessage(design === "name_qr" ? "Loading label…" : "Loading badge…");
    afterPrint.current?.();
    setJob(null);
    try {
      const count = badgePrintLayoutSchema.shape.copies.parse(copies);
      let body: BadgeLabelRequest;
      if ("userId" in target) {
        const operationId = issueOperations.current.get(target.userId) ?? crypto.randomUUID();
        issueOperations.current.set(target.userId, operationId);
        const issued = await post(
          endpoint,
          badgeIssueRequestSchema.parse({ operationId, userId: target.userId, reuseActive: true }),
          badgeIssueResponseSchema,
        );
        requireCurrent();
        body = badgeLabelRequestSchema.parse({ source: "badge", badgeId: issued.id, operationId: crypto.randomUUID() });
      } else body = target;
      const label = await post(`${endpoint}/labels`, body, badgePrintResponseSchema);
      requireCurrent();
      if (Date.parse(label.expiresAt) <= Date.now() || (body.source === "badge" && label.id !== body.badgeId))
        throw new Error("This badge is no longer available for printing.");
      const printing = design === "event_badge" ? await loadArtwork() : BADGE_LABEL_PRINTING_CONTEXT;
      requireCurrent();
      setJob({ key: crypto.randomUUID(), label, copies: count, design, sides, printing });
    } catch (cause) {
      running.current = false;
      lastScanned.current = "";
      if (current()) {
        setBusy(false);
        setMessage("");
        setError(cause instanceof Error ? cause.message : "Could not load the print document.");
        latestResume.current();
      }
    }
  }
  function scan(raw: string) {
    const parsed = badgeLabelRequestSchema.safeParse({
      source: "scan",
      credential: raw,
      operationId: crypto.randomUUID(),
    });
    if (!parsed.success || parsed.data.source !== "scan") {
      if (current()) setError("Scan an attendee’s ticket QR code.");
      return false;
    }
    if (running.current || lastScanned.current === parsed.data.credential) return false;
    lastScanned.current = parsed.data.credential;
    void load(parsed.data);
    return true;
  }
  async function printReady() {
    if (!job || printed.current === job.key) return;
    try {
      requireCurrent();
      if (Date.parse(job.label.expiresAt) <= Date.now()) throw new Error("This badge has expired.");
      const window = frame.current?.contentWindow;
      if (!window) throw new Error("The print document is unavailable. Try printing again.");
      printed.current = job.key;
      const printable = () => current() && printed.current === job.key && Date.parse(job.label.expiresAt) > Date.now();
      if (format === "pdf") {
        setMessage("Preparing PDF…");
        const { badgePrintPdf } = await import("../../../../../../components/event-badges/badge-print-pdf");
        const template = job.printing.template;
        const dimensions =
          job.design === "event_badge" && template
            ? { widthMm: template.widthMm, heightMm: template.heightMm }
            : BROTHER_DK_1208_PAPER;
        const blob = await badgePrintPdf(window.document, dimensions, printable, html);
        requireCurrent();
        if (!printable()) throw new Error("This badge is no longer available. Load it again before printing.");
        setPdf(blob);
        setMessage("PDF ready. Open or download it to print.");
        setBusy(false);
        running.current = false;
        return;
      }
      const closed = () => {
        afterPrint.current?.();
        running.current = false;
        if (current()) {
          setBusy(false);
          setMessage(`Print dialog closed for ${job.label.displayName ?? "attendee"}.`);
          latestResume.current();
        }
      };
      globalThis.window.addEventListener("afterprint", closed, { once: true });
      afterPrint.current = () => {
        globalThis.window.removeEventListener("afterprint", closed);
        afterPrint.current = null;
      };
      setMessage(`Opening print dialog for ${job.label.displayName ?? "attendee"}…`);
      await printBadgeDocument(html, printable, printOwner.current.signal);
      // Some mobile browsers omit afterprint; do not trap the operator in a busy state.
      running.current = false;
      if (current()) {
        setBusy(false);
        setMessage("Print requested. If no dialog opened, try PDF in Print settings.");
      }
    } catch (cause) {
      afterPrint.current?.();
      running.current = false;
      if (current()) {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : "Could not open printing.");
      }
    }
  }
  const html = useMemo(
    () =>
      job
        ? badgePrintHtml(
            [{ ...job.label, displayName: job.label.displayName ?? "Attendee" }],
            job.design === "event_badge" && job.printing.template
              ? {
                  ...badgeFaceLayout(job.printing.template.widthMm, job.printing.template.heightMm),
                  sides: job.sides,
                }
              : { ...badgePrintPreset("brother_dk_1208"), sides: "front", copies: job.copies },
            job.printing,
            job.design,
          )
        : "",
    [job],
  );
  return {
    frame,
    job,
    html,
    busy,
    error,
    message,
    pdf,
    scan,
    printReady,
    selectAttendee: (userId: string) => void load({ userId }),
    reprint: () => {
      if (job)
        void load(
          badgeLabelRequestSchema.parse({ source: "badge", badgeId: job.label.id, operationId: crypto.randomUUID() }),
        );
    },
    documentError: (message: string) => {
      running.current = false;
      if (current()) {
        setBusy(false);
        setError(message);
      }
    },
  };
}
