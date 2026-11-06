import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { Button } from "../Button";
import { ErrorAlert } from "../../components/ErrorAlert";
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
  const [labels, setLabels] = useState(2);
  const [sides, setSides] = useState<BadgePrintLayout["sides"]>("front_back");
  return (
    <div>
      <BadgeLabelDeskView
        video={createRef()}
        cameraActive={state === "ready"}
        starting={false}
        busy={state === "preparing"}
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
        {state === "preparing" && <p role="status">Preparing label…</p>}
        {state === "requested" && (
          <>
            <p role="status">Print requested.</p>
            <Button>Print labels again</Button>
          </>
        )}
        {state === "pdf" && (
          <>
            <p role="status">PDF ready. Open or download it to print.</p>
            <div class="pk-cluster">
              <Button>Open PDF</Button>
              <Button>Download PDF</Button>
            </div>
          </>
        )}
        {state === "error" && <ErrorAlert error="Could not prepare the print document. Try again." />}
      </BadgeLabelDeskView>
    </div>
  );
}

export const badgeLabelDeskSection: PreviewSection = {
  id: "badge-label-desk",
  title: "Badge printing scanner",
  render: () => <PrintDeskExample />,
};
