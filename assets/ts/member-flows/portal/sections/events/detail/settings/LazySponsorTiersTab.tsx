import { lazy, Suspense } from "preact/compat";

import { Spinner } from "../../../../../../components/Spinner";

const SponsorTiersTab = lazy(async () => {
  const module = await import("./SponsorTiersTab");
  return { default: module.SponsorTiersTab };
});

export function LazySponsorTiersTab(props: { slug: string; canWrite: boolean; endpoint?: string }) {
  return (
    <Suspense fallback={<Spinner label="Loading sponsor tiers…" />}>
      <SponsorTiersTab {...props} />
    </Suspense>
  );
}
