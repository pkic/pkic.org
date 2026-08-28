import { useState } from "preact/hooks";
import { EmailOutbox } from "./EmailOutbox";
import { DueWork } from "./DueWork";

type OperationsTab = "outbox" | "due-work";

export function Operations({
  initialTab,
  canReadEmail,
  canManageEmail,
  canReadOperations,
  canRunOperations,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
}: {
  initialTab?: string;
  canReadEmail: boolean;
  canManageEmail: boolean;
  canReadOperations: boolean;
  canRunOperations: boolean;
  canAnonymizeUsers: boolean;
  canWriteMembership: boolean;
  canApproveMembership: boolean;
}) {
  const readableTabs: OperationsTab[] = [
    ...(canReadEmail ? ["outbox" as const] : []),
    ...(canReadOperations ? ["due-work" as const] : []),
  ];
  const [tab, setTab] = useState<OperationsTab>(() =>
    readableTabs.includes(initialTab as OperationsTab) ? (initialTab as OperationsTab) : (readableTabs[0] ?? "outbox"),
  );
  const selectedTab = readableTabs.includes(tab) ? tab : readableTabs[0];

  if (!readableTabs.length) {
    return (
      <div class="alert alert-warning" role="alert">
        Operations access is not assigned to this account.
      </div>
    );
  }

  return (
    <section aria-labelledby="system-operations-heading">
      <h5 id="system-operations-heading" class="mb-3">
        System Operations
      </h5>
      <nav class="nav nav-tabs mb-3" aria-label="System operations">
        {readableTabs.map((key) => (
          <button
            key={key}
            type="button"
            class={`nav-link${selectedTab === key ? " active" : ""}`}
            aria-selected={selectedTab === key}
            role="tab"
            onClick={() => setTab(key)}
          >
            {key === "outbox" ? "Email Outbox" : "Due Work"}
          </button>
        ))}
      </nav>
      {selectedTab === "outbox" && canReadEmail ? (
        <EmailOutbox canManage={canManageEmail} />
      ) : selectedTab === "due-work" && canReadOperations ? (
        <DueWork
          canRun={canRunOperations}
          canAnonymizeUsers={canAnonymizeUsers}
          canWriteMembership={canWriteMembership}
          canApproveMembership={canApproveMembership}
        />
      ) : null}
    </section>
  );
}
