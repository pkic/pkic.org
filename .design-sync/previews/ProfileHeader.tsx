import { Avatar, Badge, Button, Menu, ProfileHeader } from "pkic-org-events-backend";

const noop = () => {};

/** A person's record, viewed by another member. */
export function PersonRecord() {
  return (
    <div class="pk">
      <ProfileHeader
        media={<Avatar name="Paul van Brouwershaven" size="xl" status={{ label: "Board member" }} />}
        title="Paul van Brouwershaven"
        pill="Open to opportunities"
        lede="Solution architect at Digitorus · Chair, CBOM Profiles Working Group"
        facts={["Utrecht, Netherlands", "Member since June 2024", "Dutch, English"]}
        actions={
          <>
            <Button variant="primary" size="sm" onClick={noop}>
              Message
            </Button>
            <Button variant="secondary" size="sm" onClick={noop}>
              Follow
            </Button>
            <Menu
              label="More actions"
              align="end"
              items={[
                { id: "invite", label: "Invite to a group…", onSelect: noop },
                { id: "vouch", label: "Vouch for a skill…", onSelect: noop },
                { id: "report", label: "Report this profile", separatorBefore: true, danger: true, onSelect: noop },
              ]}
            />
          </>
        }
      />
    </div>
  );
}

/**
 * The same header with an organization as its subject — the reason this
 * component is subject-agnostic rather than a person-profile header.
 */
export function OrganizationRecord() {
  return (
    <div class="pk">
      <ProfileHeader
        media={<Avatar name="SecureTrust Authority" size="xl" />}
        title="SecureTrust Authority"
        pill={<Badge tone="ok">Steering member</Badge>}
        lede="Certification authority · Eight delegates across four working groups"
        facts={["Tallinn, Estonia", "Member since 2019", "Agreement renews Nov 2026"]}
        actions={
          <Button variant="secondary" size="sm" onClick={noop}>
            Manage organization
          </Button>
        }
      />
    </div>
  );
}

/** The record of someone with no standing, no availability and no actions. */
export function MinimalSubject() {
  return (
    <div class="pk">
      <ProfileHeader
        media={<Avatar name="Marta Oliveira" size="xl" />}
        title="Marta Oliveira"
        lede="Observer, Ibérica Trust Services"
        facts={["Member since February 2025"]}
      />
    </div>
  );
}
