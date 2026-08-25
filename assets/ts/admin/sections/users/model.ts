export interface UserMembership {
  memberId: string;
  membershipCategory: string;
  status: string;
  showOnOrgProfile: boolean;
  organizationId: string | null;
  organizationName: string | null;
  createdAt: string;
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    type: { key: string; singularLabel: string; pluralLabel: string };
  }>;
}

export interface UserDetail {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links?: Array<string | { label?: string | null; url?: string | null }>;
  role: string;
  active: boolean;
  isEcMember?: boolean;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshotUrl: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
  memberships: UserMembership[];
}
