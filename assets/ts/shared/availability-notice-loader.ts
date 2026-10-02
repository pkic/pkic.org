import { AVAILABILITY_EVENT } from "./availability-events";

/** API-driven service notices stay out of the anonymous browsing entry. */
export function installDeferredAvailabilityNotice(): void {
  window.addEventListener(
    AVAILABILITY_EVENT,
    () => {
      void import("./availability-notice")
        .then(({ installAvailabilityNotice }) => installAvailabilityNotice())
        .catch((error: unknown) => console.error("Unable to show the service availability notice", error));
    },
    { once: true },
  );
}
