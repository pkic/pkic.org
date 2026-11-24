import { lazy, Suspense } from "preact/compat";

import { Spinner } from "../../../../../../../components/Spinner";
import type { TicketSettingsSection } from "./TicketsTab";

const TicketsTab = lazy(async () => {
  const module = await import("./TicketsTab");
  return { default: module.TicketsTab };
});

export function LazyTicketsTab(props: {
  slug: string;
  canWrite: boolean;
  section?: TicketSettingsSection;
  detail?: string;
  segment?: string;
  basePath?: string;
}) {
  return (
    <Suspense fallback={<Spinner label="Loading tickets…" />}>
      <TicketsTab {...props} />
    </Suspense>
  );
}
