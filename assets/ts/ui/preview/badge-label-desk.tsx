import { useScannerAudio } from "../../member-flows/portal/sections/events/detail/scanner/useScannerAudio";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { Button } from "../Button";
import { createRef } from "preact";
import { useState } from "preact/hooks";
import type { BadgePrintLayout } from "../../../shared/schemas/badge-print-layout";
import type { BadgePrintDesign } from "../../../shared/schemas/event-badge-template";
import { TextInput } from "../TextControl";
import { BadgeLabelDeskView } from "../../member-flows/portal/sections/events/detail/badges/BadgeLabelDesk";
import type { PreviewSection } from "./PreviewShell";
import "./badge-label-desk.css";

function PrintDeskExample() {
  const [design, setDesign] = useState<BadgePrintDesign>("name_qr");
  const [state] = useHashQueryParam("printState", "ready", ["ready", "preparing", "requested", "pdf", "error"]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audio = useScannerAudio(soundEnabled, "print");
  const [labels, setLabels] = useState(2);
  const [sides, setSides] = useState<BadgePrintLayout["sides"]>("front_back");
  return (
    <div>
      <BadgeLabelDeskView
        sound={{ ...audio, toggleSound: () => audio.toggle(setSoundEnabled) }}
        video={createRef()}
        cameraActive={state === "ready"}
        starting={false}
        busy={state === "preparing"}
        status={
          state === "error"
            ? {
                key: "sample-error",
                tone: "denied",
                title: "Could not print",
                detail: "Could not prepare the print document. Try again.",
              }
            : state === "requested" || state === "pdf"
              ? {
                  key: state,
                  tone: "eligible",
                  title: state === "pdf" ? "PDF ready" : "Print requested",
                  detail: "Alex Morgan",
                }
              : undefined
        }
        copies={labels}
        design={design}
        onDesign={setDesign}
        onCopies={setLabels}
        sides={sides}
        onSides={setSides}
        start={() => {}}
        stop={() => {}}
        search={(control) => (
          <TextInput {...control} type="search" placeholder="Name, email, or organization" readOnly />
        )}
      >
        {state === "requested" && (
          <>
            <Button>Print labels again</Button>
          </>
        )}
        {state === "pdf" && (
          <>
            <div class="pk-cluster">
              <Button>Share PDF</Button>
              <Button>Download PDF</Button>
            </div>
          </>
        )}
      </BadgeLabelDeskView>
    </div>
  );
}

export const badgeLabelDeskSection: PreviewSection = {
  id: "badge-label-desk",
  title: "Badge printing scanner",
  render: () => <PrintDeskExample />,
};
