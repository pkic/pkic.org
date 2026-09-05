import { Breadcrumb } from "pkic-org-events-backend";

/**
 * The trail to the current page. The last item is always plain text carrying
 * aria-current="page"; an item without an href is an ancestor that has no page
 * of its own.
 */

export function GroupTrail() {
  return (
    <div class="pk">
      <Breadcrumb
        items={[
          { label: "Portal", href: "/portal" },
          { label: "Working groups", href: "/portal/groups" },
          { label: "Post-Quantum Cryptography" },
        ]}
      />
    </div>
  );
}

export function DeepRecordTrail() {
  return (
    <div class="pk">
      <Breadcrumb
        items={[
          { label: "Portal", href: "/portal" },
          { label: "Organizations", href: "/portal/organizations" },
          { label: "Entrust", href: "/portal/organizations/entrust" },
          { label: "Agreements", href: "/portal/organizations/entrust/agreements" },
          { label: "Membership agreement 2026" },
        ]}
      />
    </div>
  );
}

export function UnlinkedAncestor() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Breadcrumb
        label="Certificate trail"
        items={[
          { label: "Portal", href: "/portal" },
          { label: "Certificates" },
          { label: "PKI Consortium Issuing CA G2" },
        ]}
      />
      <p class="pk-small pk-muted">
        &ldquo;Certificates&rdquo; has no page of its own, so it renders as plain text rather than a link.
      </p>
    </div>
  );
}
