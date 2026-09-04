import { Badge, Button, PageHeader } from "pkic-org-events-backend";

/**
 * The first region of every portal page: the trail, the subject as the
 * heading, the subject's standing beside it, and what can be done to it on the
 * right. The cells sweep the optional slots — a full record header, a section
 * root with no trail, and the bare minimum.
 */

export function WorkingGroupRecord() {
  return (
    <div class="pk">
      <PageHeader
        trail={[
          { label: "Portal", href: "/portal" },
          { label: "Working groups", href: "/portal/groups" },
          { label: "Post-Quantum Cryptography" },
        ]}
        title="Post-Quantum Cryptography"
        context={
          <>
            <Badge tone="ok" dot>
              Active
            </Badge>
            <Badge tone="neutral">42 members</Badge>
          </>
        }
        actions={
          <>
            <Button variant="secondary">Export roster</Button>
            <Button variant="primary">Invite member</Button>
          </>
        }
        description="Tracks migration guidance for certificate authorities adopting ML-DSA and ML-KEM."
      />
    </div>
  );
}

export function SectionRoot() {
  return (
    <div class="pk">
      <PageHeader
        title="Member organizations"
        context={<Badge tone="neutral">128 organizations</Badge>}
        actions={<Button variant="primary">Add organization</Button>}
        description="Every organization holding a signed membership agreement."
      />
    </div>
  );
}

export function SubjectOnly() {
  return (
    <div class="pk">
      <PageHeader
        trail={[
          { label: "Portal", href: "/portal" },
          { label: "Certificates", href: "/portal/certificates" },
          { label: "PKI Consortium Issuing CA G2" },
        ]}
        title="PKI Consortium Issuing CA G2"
      />
    </div>
  );
}

export function AwaitingReview() {
  return (
    <div class="pk">
      <PageHeader
        trail={[
          { label: "Portal", href: "/portal" },
          { label: "Charters", href: "/portal/charters" },
          { label: "Certificate Lifecycle Management" },
        ]}
        title="Certificate Lifecycle Management"
        context={
          <Badge tone="warn" dot>
            Awaiting review
          </Badge>
        }
        actions={
          <>
            <Button variant="danger-quiet">Withdraw</Button>
            <Button variant="primary">Approve</Button>
          </>
        }
        description="Submitted by the Executive Council on 12 May, open for member comment until 30 June."
      />
    </div>
  );
}
