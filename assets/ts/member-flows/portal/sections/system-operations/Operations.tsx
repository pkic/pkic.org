/**
 * System operations: the outbox, the retention queue, and the job registry.
 *
 * The tab strip was a `nav nav-tabs` of buttons that claimed `role="tab"`
 * without a `tablist` around them, so nothing linked a tab to the panel it
 * controlled and no arrow key moved between them. `Tabs` resolves to the
 * design system's TabList here — buttons, because these tabs swap a panel
 * already on the page rather than navigating anywhere.
 */
import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { Alert } from "../../../../ui/Alert";
import { EmailOutbox } from "./EmailOutbox";
import { ScheduledWork } from "./ScheduledWork";

const ScheduledJobs = lazy(() => import("./ScheduledJobs").then((module) => ({ default: module.ScheduledJobs })));

type OperationsTab = "outbox" | "scheduled-work" | "scheduler";

const TAB_LABELS: Record<OperationsTab, string> = {
  outbox: "Email Outbox",
  "scheduled-work": "Scheduled Work",
  scheduler: "Scheduled Jobs",
};

const TAB_ID_PREFIX = "system-operations";

function panelIdFor(tab: OperationsTab): string {
  return `${TAB_ID_PREFIX}-${tab}-panel`;
}

function TabPanel({ tab, children }: { tab: OperationsTab; children: ComponentChildren }) {
  return (
    <div id={panelIdFor(tab)} role="tabpanel" aria-labelledby={`${TAB_ID_PREFIX}-${tab}`}>
      {children}
    </div>
  );
}

export function Operations({
  initialTab,
  canReadEmail,
  canManageEmail,
  canReadRetention,
  canReadScheduler,
  canRunRetention,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
}: {
  initialTab?: string;
  canReadEmail: boolean;
  canManageEmail: boolean;
  canReadRetention: boolean;
  canReadScheduler: boolean;
  canRunRetention: boolean;
  canAnonymizeUsers: boolean;
  canWriteMembership: boolean;
  canApproveMembership: boolean;
}) {
  const readableTabs: OperationsTab[] = [
    ...(canReadEmail ? ["outbox" as const] : []),
    ...(canReadRetention ? ["scheduled-work" as const] : []),
    ...(canReadScheduler ? ["scheduler" as const] : []),
  ];
  const [tab, setTab] = useState<OperationsTab>(() =>
    readableTabs.includes(initialTab as OperationsTab) ? (initialTab as OperationsTab) : (readableTabs[0] ?? "outbox"),
  );
  // The route names the tab; a later navigation to another sub-path lands on
  // the same mounted component, so the state initializer alone left the URL
  // and the selected tab disagreeing.
  useEffect(() => {
    if (readableTabs.includes(initialTab as OperationsTab)) setTab(initialTab as OperationsTab);
    // Reacts to the routed segment only; the permission-derived tab list is
    // stable for a session.
  }, [initialTab]);
  const selectedTab = readableTabs.includes(tab) ? tab : readableTabs[0];

  if (!readableTabs.length) {
    return <Alert tone="warn">Operations access is not assigned to this account.</Alert>;
  }

  return (
    // The Settings hub's "Operations" tab already names this surface, so it
    // opens with its own sub-navigation rather than a heading repeating it.
    <section class="pk-stack" aria-label="System operations">
      <Tabs
        label="System operations"
        idPrefix={TAB_ID_PREFIX}
        items={readableTabs.map((key) => ({ key, label: TAB_LABELS[key], panelId: panelIdFor(key) }))}
        active={selectedTab ?? readableTabs[0]}
        onChange={(key) => setTab(key as OperationsTab)}
      />
      {/* Each panel names itself and points back at the tab that revealed it,
          which is the other half of the contract `role="tab"` makes. */}
      {selectedTab === "outbox" && canReadEmail ? (
        <TabPanel tab="outbox">
          <EmailOutbox canManage={canManageEmail} />
        </TabPanel>
      ) : selectedTab === "scheduled-work" && canReadRetention ? (
        <TabPanel tab="scheduled-work">
          <ScheduledWork
            canManageEmail={canManageEmail}
            canRunRetention={canRunRetention}
            canAnonymizeUsers={canAnonymizeUsers}
            canWriteMembership={canWriteMembership}
            canApproveMembership={canApproveMembership}
          />
        </TabPanel>
      ) : selectedTab === "scheduler" && canReadScheduler ? (
        <TabPanel tab="scheduler">
          <Suspense fallback={<Spinner />}>
            <ScheduledJobs />
          </Suspense>
        </TabPanel>
      ) : null}
    </section>
  );
}
