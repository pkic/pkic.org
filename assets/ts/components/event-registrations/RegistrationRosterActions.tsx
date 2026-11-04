import { useState } from "preact/hooks";
import { eventRegistrationPromotionsResponseSchema } from "../../../shared/schemas/event-registrations";
import { postJson } from "../../shared/api-client";
import { registrationOutputMenuItems } from "./RegistrationOutputActions";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
import { Menu } from "../../ui/Menu";

export function RegistrationRosterActions({
  promotionsEndpoint,
  exportsEndpoint,
  sponsorExportUrl,
  onPromoted,
  notify,
  onPrintAllMatching,
}: {
  promotionsEndpoint: string;
  exportsEndpoint: string | null;
  sponsorExportUrl?: string | null;
  onPromoted: () => void | Promise<void>;
  notify: (message: string, kind: "success" | "error") => void;
  onPrintAllMatching?: (action: BadgePrintAction) => void;
}) {
  const [promoting, setPromoting] = useState(false);

  async function runWaitlistPromotions() {
    setPromoting(true);
    try {
      await postJson(promotionsEndpoint, {}, eventRegistrationPromotionsResponseSchema);
      notify("Waitlist promotions run", "success");
      await onPromoted();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <Menu
      label="Registration actions"
      align="end"
      items={[
        ...registrationOutputMenuItems({
          attendeeUrl: exportsEndpoint,
          sponsorUrl: sponsorExportUrl ?? null,
          onPrint: onPrintAllMatching,
        }),
        {
          id: "waitlist-promotions",
          label: promoting ? "Running promotions…" : "Run waitlist promotions",
          separatorBefore: true,
          disabled: promoting,
          onSelect: () => void runWaitlistPromotions(),
        },
      ]}
    />
  );
}
