import type { RefObject } from "preact";
import { GuidedTour, type GuidedTourStep } from "../../../../../../ui/GuidedTour";
import { Button } from "../../../../../../ui/Button";
import type { ScannerRole } from "./scanner-role";
import type { ScannerStatus } from "./ScannerStatus";
import type { ScannerSound } from "./scanner-audio-feedback";

const roleGuidance: Record<ScannerRole, string> = {
  entry:
    "Check that this is the entry scanner, then scan the attendee’s badge. Use the result on screen to decide what to do next.",
  exit: "Use this scanner as attendees leave the venue. It records their exit instead of checking them in.",
  session: "Check the session or room shown here, then scan each attendee as they enter that session.",
  lead: "Scan an attendee’s badge, review their details, and ask for their permission before confirming the lead.",
  print: "Scan an attendee’s ticket to print the selected labels or full badge.",
};

export function ScannerHelpTour({
  scope,
  role,
  onClose,
  onDemo,
  onSound,
}: {
  scope: RefObject<HTMLElement>;
  role: ScannerRole;
  onClose: () => void;
  onDemo: (status: ScannerStatus | undefined) => void;
  onSound?: (sound: ScannerSound) => void;
}) {
  const examples: Record<string, ScannerStatus> = {
    success: {
      key: "tour-success",
      tone: "eligible",
      title:
        role === "print"
          ? "Example: Print requested"
          : role === "lead"
            ? "Example: Lead saved"
            : "Example: Scan accepted",
      detail: "Tour example",
    },
    warning: {
      key: "tour-warning",
      tone: "warning",
      title: "Example: Needs attention",
      detail: "Read the message before continuing.",
    },
    error: {
      key: "tour-error",
      tone: "denied",
      title: role === "print" ? "Example: Could not print" : "Example: Badge not valid",
      detail: "Check the badge or use the available recovery options.",
    },
  };
  const steps: GuidedTourStep[] = [
    {
      id: "mode",
      target: '[data-scanner-help="feedback"]',
      title: "Check your scanner",
      body: `${roleGuidance[role]} Live capture is paused during this tour.`,
    },
    {
      id: "camera",
      target: '[data-scanner-help="camera"]',
      title: "Use the camera",
      body: "Tap the camera to start scanning. When it is running, this button shows or hides the preview. Hold one QR code steady in front of the camera.",
    },
    {
      id: "find",
      target: '[data-scanner-help="find"]',
      title: "Find an attendee",
      body:
        role === "print"
          ? "Use search if the attendee cannot show their ticket. Search by name, email, or organization, then choose the attendee to print."
          : "If the badge will not scan, find the attendee or enter the code printed on their badge.",
    },
    {
      id: "success",
      target: '[data-scanner-help="feedback"]',
      title: "A successful scan",
      body:
        role === "print"
          ? "Green means the print request was prepared. Check the printer for the actual labels or badge. Listen to the print sound."
          : "Green confirms a successful scan. Each scanner mode has its own sound, so you can hear if you are using the wrong scanner.",
    },
    {
      id: "warning",
      target: '[data-scanner-help="feedback"]',
      title: "Pause for a warning",
      body: "Yellow means the scan needs attention or verification. Read the message before continuing. The warning sound is longer than a successful scan.",
    },
    {
      id: "error",
      target: '[data-scanner-help="feedback"]',
      title: "Read an error",
      body: "Red means the badge or action could not be accepted. Read the message and resolve the problem before trying again. Listen for the error sound.",
    },
    {
      id: "results",
      target: '[data-scanner-help="results"]',
      title: "Check the last few results",
      body: "The last five results stay here as checks, warning marks, or crosses. Scanning resumes automatically; there is no Next button after a live scan.",
    },
    {
      id: "switch",
      target: '[data-scanner-help="switch"]',
      title: "Switch scanners",
      body: "Swipe left or right to switch between the scanner tasks available to you. Check the large icon and ready message after switching.",
    },
    {
      id: "options",
      target: '[data-scanner-help="options"]',
      title: "More controls",
      body:
        role === "print"
          ? "Open the tools for labels or full badges, copies or sides, and the optional PDF fallback. Use Share PDF when your browser supports it. Close the scanner with the × button."
          : "Open the tools for scanner details and recovery options. Tap the speaker to control sounds, and use × to close the scanner. You can replay this tour with the help button.",
    },
  ];
  const soundFor = (id: string): ScannerSound => (id === "success" ? role : id === "warning" ? "warning" : "error");
  return (
    <GuidedTour
      scope={scope}
      steps={steps.map((step) => ({
        ...step,
        actions:
          examples[step.id] && onSound ? (
            <Button onClick={() => onSound(soundFor(step.id))}>Replay sound</Button>
          ) : undefined,
      }))}
      onClose={onClose}
      onStepChange={(id) => {
        onDemo(id ? examples[id] : undefined);
        if (id && examples[id]) onSound?.(soundFor(id));
      }}
    />
  );
}
