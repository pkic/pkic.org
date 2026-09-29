import { lazy, Suspense } from "preact/compat";

import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { Spinner } from "../../../../components/Spinner";

const GroupEventConfiguration = lazy(async () => {
  const module = await import("./GroupEventConfiguration");
  return { default: module.GroupEventConfiguration };
});

export function LazyGroupEventConfiguration(props: {
  event: GroupEvent;
  groupId: string;
  onUpdated?: () => void | Promise<void>;
}) {
  return (
    <Suspense fallback={<Spinner label="Loading event configuration…" />}>
      <GroupEventConfiguration {...props} />
    </Suspense>
  );
}
