import { useState } from "preact/hooks";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { downloadBadgeArtifact } from "../../../../../../components/event-badges/badge-print-artifacts";

export function BadgePdfActions({ pdf, url }: { pdf: Blob; url: string }) {
  const [error, setError] = useState("");
  const file = new File([pdf], "attendee-print.pdf", { type: "application/pdf" });
  const shareable = typeof navigator.share === "function" && navigator.canShare?.({ files: [file] });
  const share = async () => {
    setError("");
    try {
      await navigator.share({ files: [file], title: "Attendee print" });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError("Could not share the PDF. Open or download it instead.");
    }
  };
  return (
    <>
      <div class="pk-cluster">
        {shareable && <Button onClick={() => void share()}>Share PDF</Button>}
        {(!shareable || error) && (
          <ButtonLink href={url} external>
            Open PDF
          </ButtonLink>
        )}
        <Button onClick={() => downloadBadgeArtifact(pdf, "application/pdf", file.name)}>Download PDF</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
