import { createRef } from "preact";
import { useState } from "preact/hooks";
import type { BadgePrintLayout } from "../../../shared/schemas/badge-print-layout";
import type { BadgePrintDesign } from "../../../shared/schemas/event-badge-template";
import { TextInput } from "../TextControl";
import { BadgeLabelDeskView } from "../../member-flows/portal/sections/events/detail/badges/BadgeLabelDesk";
import type { PreviewSection } from "./PreviewShell";
import "./badge-label-desk.css";

function PrintDeskExample() {
  const [design, setDesign] = useState<BadgePrintDesign>("event_badge");
  const [labels, setLabels] = useState(2);
  const [sides, setSides] = useState<BadgePrintLayout["sides"]>("front_back");
  return (
    <div>
      <BadgeLabelDeskView
        video={createRef()}
        cameraActive={false}
        starting={false}
        busy={false}
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
      />
    </div>
  );
}

export const badgeLabelDeskSection: PreviewSection = {
  id: "badge-label-desk",
  title: "Badge printing scanner",
  render: () => <PrintDeskExample />,
};
