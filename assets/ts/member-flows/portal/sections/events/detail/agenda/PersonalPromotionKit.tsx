import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import { Alert } from "../../../../../../ui/Alert";
import { downloadFile } from "../../../../../../shared/download-file";
import { loadPromotionKit } from "./promotion-kit-client";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { promotionKitSchema, promotionFormatSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import { postJson, getBlob } from "../../../../../../shared/api-client";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { IconPlus } from "../../../../../../components/icons";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { ExternalLink } from "../../../../../../ui/ExternalLink";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PromotionCompositionEditor } from "./PromotionCompositionEditor";
import { copyText } from "../../../../../../shared/clipboard";
import { toast } from "../../../../ui";
import "./SessionPromotionKit.css";
type Kit = z.infer<typeof promotionKitSchema>;
export function PersonalPromotionKit({ base, title, onClose }: { base: string; title: string; onClose?: () => void }) {
  const [kit, setKit] = useState<Kit | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<"prepare" | "download" | null>(null);
  const [editing, showEditing, closeEditing] = useDialogQueryState(`promotionComposition:${base}`);
  useEffect(() => {
    let cancelled = false;
    setKit(null);
    void loadPromotionKit(base)
      .then((value) => {
        if (!cancelled) setKit(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load promotion materials.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  useEffect(() => {
    if (!kit?.artifacts.some((item) => ["queued", "rendering", "retrying"].includes(item.status))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadPromotionKit(base)
        .then((value) => {
          if (!cancelled) setKit(value);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not refresh your materials.");
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kit, base]);
  async function prepare() {
    setBusy("prepare");
    try {
      setKit(
        await postJson(
          `${base}/renders`,
          {
            fingerprint: kit!.fingerprint,
            publishedRevision: kit!.publishedRevision,
            compositionRevision: kit!.compositionRevision,
          },
          promotionKitSchema,
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare your materials.");
    } finally {
      setBusy(null);
    }
  }
  async function download(format: string) {
    if (!kit) return;
    setBusy("download");
    try {
      const content = await getBlob(artifact(format));
      const extension = content.type === "application/zip" ? "zip" : format === "carousel" ? "pdf" : "png";
      downloadFile(content, content.type, `promotion-${format}.${extension}`);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not download these materials.");
    } finally {
      setBusy(null);
    }
  }
  const artifact = (format: string, preview = false) =>
    `${base}/artifact?format=${encodeURIComponent(format)}&revision=${kit!.publishedRevision}&fingerprint=${kit!.fingerprint}${preview ? "&download=false" : ""}`;
  return (
    <Panel>
      <PanelHeader title={title}>
        {kit && (
          <Button
            icon
            aria-label="Personalize promotion materials"
            title="Personalize promotion materials"
            onClick={showEditing}
          >
            <IconPlus />
          </Button>
        )}
        {onClose && <CloseButton label="Close promotion materials" onClick={onClose} />}
      </PanelHeader>
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        {kit && (
          <div class="pk-stack">
            {kit.stale && (
              <Alert tone="warn">
                Unavailable sessions have been removed from this draft. Use the + button to review and save your
                materials to continue.
              </Alert>
            )}
            <p>Your downloads and registration link credit referrals to you.</p>
            <ExternalLink href={kit.registrationUrl}>Your registration referral link</ExternalLink>
            <div class="pk-promotion-kit__actions">
              <Button onClick={prepare} loading={busy === "prepare"} disabled={kit.stale || busy === "download"}>
                Prepare downloads
              </Button>
              <Button
                onClick={() =>
                  void copyText(`${kit.source?.title ?? title}\n${kit.copy.whyAttend}\n${kit.registrationUrl}`, {
                    copied: "Post and registration link copied",
                    failed: "Your browser could not copy the post",
                    notify: toast,
                  })
                }
              >
                Copy post and registration link
              </Button>
            </div>
            <PromotionCompositionEditor
              open={editing}
              key={kit.compositionRevision}
              kit={kit}
              base={base}
              onCancel={closeEditing}
              onSaved={(value) => {
                setKit(value);
                void closeEditing();
              }}
            />
            <ul>
              {promotionFormatSchema.options.map((format) => {
                const state = kit.artifacts.find((item) => item.format === format);
                return (
                  <li key={format}>
                    {state?.status === "rendered" ? (
                      <a
                        href={artifact(format)}
                        download
                        aria-disabled={Boolean(busy)}
                        onClick={(event) => {
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                            return;
                          event.preventDefault();
                          if (!busy) void download(format);
                        }}
                      >
                        {format === "carousel" ? "Carousel PDF" : `${format} images`}
                      </a>
                    ) : (
                      <span>
                        {format}: {state?.status ?? "not prepared"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {kit.artifacts.some((item) => item.format === "portrait" && item.status === "rendered") && (
              <img
                class="pk-promotion-kit__preview"
                src={artifact("portrait", true)}
                width="1080"
                height="1350"
                alt="Preview of your promotion materials"
              />
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
