import { useState } from "preact/hooks";
import { eventRegistrationPromotionsResponseSchema } from "../../../shared/schemas/event-registrations";
import { postJson } from "../../shared/api-client";
import { DownloadAction } from "../../ui/DownloadAction";
import { Menu } from "../../ui/Menu";

export function RegistrationRosterActions({
  promotionsEndpoint,
  exportsEndpoint,
  onPromoted,
  notify,
  onPrintAllMatching,
}: {
  promotionsEndpoint: string;
  exportsEndpoint: string;
  onPromoted: () => void | Promise<void>;
  notify: (message: string, kind: "success" | "error") => void;
  onPrintAllMatching?: () => void;
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
    <>
      <Menu
        label="Registration actions"
        align="end"
        items={[
          ...(onPrintAllMatching
            ? [{ id: "print-all-matching", label: "Create / print all matching badges", onSelect: onPrintAllMatching }]
            : []),
          {
            id: "waitlist-promotions",
            label: promoting ? "Running promotions…" : "Run waitlist promotions",
            disabled: promoting,
            onSelect: () => void runWaitlistPromotions(),
          },
        ]}
      />
      <DownloadAction label="Download registrations (CSV)" href={exportsEndpoint} />
    </>
  );
}
