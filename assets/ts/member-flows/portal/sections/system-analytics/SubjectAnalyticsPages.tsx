/**
 * The membership, organization and account analytics pages (#39).
 *
 * Each reads one bounded projection and hands `SubjectAnalytics` the figures
 * that domain actually has. They live together because they are three
 * configurations of one page rather than three pages: the arrangement is
 * shared, the nouns are not.
 *
 * The numbers are the server's. Nothing here adds a column up or derives a
 * percentage from a fetched list — a page that does that is doing a query's
 * job in the browser, and it drifts from the list it claims to summarize.
 */
import type { Column } from "../../../../components/Table";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import {
  membershipAnalyticsResponseSchema,
  organizationAnalyticsResponseSchema,
  userAnalyticsResponseSchema,
} from "../../../../../shared/schemas/analytics";
import { SubjectAnalytics } from "./SubjectAnalytics";

interface CategoryRow {
  code: string;
  label: string;
  count: number;
}

/**
 * Stored codes, written as words.
 *
 * `active`, `lapsed`, `pending` are right in a column and wrong in a chart
 * legend. Capitalized rather than translated through a table: these are the
 * domain's own words already, and inventing a second vocabulary for them here
 * is how a legend and a filter end up disagreeing.
 */
function labelled(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [key.charAt(0).toUpperCase() + key.slice(1), count]),
  );
}

export function MembershipAnalytics() {
  const state = useData(() => getJson("/api/v1/analytics/members", membershipAnalyticsResponseSchema), []);
  const members = state.data?.members;
  const categoryColumns: Column<CategoryRow>[] = [
    { header: "Category", cell: (row) => `${row.label} (${row.code})` },
    { header: "Members", cell: (row) => String(row.count), width: "fit" },
  ];

  return (
    <SubjectAnalytics
      title="Membership analytics"
      lede="One row per membership — an organization or an individual — never one per representative."
      loading={state.loading}
      error={state.error}
      figures={[
        { label: "Memberships", value: members?.total ?? 0 },
        {
          label: "Represented",
          value: members?.representation.withRepresentatives ?? 0,
          note: `${members?.representation.withoutRepresentatives ?? 0} with nobody seated`,
        },
        { label: "Organizations", value: members?.byKind.organization ?? 0 },
        { label: "Individuals", value: members?.byKind.individual ?? 0 },
      ]}
      splits={[{ title: "By standing", counts: labelled(members?.byStatus ?? {}) }]}
      series={
        members
          ? { title: "Memberships begun, by month", points: members.joinedMonthly, valueHeader: "Memberships" }
          : null
      }
      table={{
        title: "By category",
        rows: (members?.byCategory ?? []) as CategoryRow[],
        columns: categoryColumns,
        empty: "No memberships yet.",
      }}
    />
  );
}

export function OrganizationAnalytics() {
  const state = useData(() => getJson("/api/v1/analytics/organizations", organizationAnalyticsResponseSchema), []);
  const organizations = state.data?.organizations;

  return (
    <SubjectAnalytics
      title="Organization analytics"
      lede="Every organization the consortium has a record of. Membership is something an organization holds, not something being recorded makes it."
      loading={state.loading}
      error={state.error}
      figures={[
        { label: "Organizations", value: organizations?.total ?? 0 },
        {
          label: "Members",
          value: organizations?.members ?? 0,
          note: `${organizations?.recordedOnly ?? 0} recorded only`,
        },
        {
          label: "Represented",
          value: organizations?.withRepresentatives ?? 0,
          note: `${organizations?.withoutRepresentatives ?? 0} with nobody seated`,
        },
        {
          label: "With a logo",
          value: organizations?.withLogo ?? 0,
          note: `${organizations?.withWebsite ?? 0} with a website`,
        },
      ]}
      splits={[
        {
          title: "Membership",
          counts: { Members: organizations?.members ?? 0, "Recorded only": organizations?.recordedOnly ?? 0 },
        },
        {
          title: "Representation",
          counts: {
            Represented: organizations?.withRepresentatives ?? 0,
            "Nobody seated": organizations?.withoutRepresentatives ?? 0,
          },
        },
      ]}
      series={
        organizations
          ? {
              title: "Organizations recorded, by month",
              points: organizations.createdMonthly,
              valueHeader: "Organizations",
            }
          : null
      }
    />
  );
}

export function UserAnalytics() {
  const state = useData(() => getJson("/api/v1/analytics/users", userAnalyticsResponseSchema), []);
  const users = state.data?.users;

  return (
    <SubjectAnalytics
      title="User analytics"
      lede="Accounts that can sign in. Most act in no membership capacity, which is what an address book looks like."
      loading={state.loading}
      error={state.error}
      figures={[
        { label: "Accounts", value: users?.total ?? 0 },
        { label: "Active", value: users?.active ?? 0, note: `${users?.inactive ?? 0} deactivated` },
        {
          label: "Acting in a capacity",
          value: users?.withIdentities ?? 0,
          note: `${users?.withoutIdentities ?? 0} contacts only`,
        },
      ]}
      splits={[
        { title: "By role", counts: labelled(users?.byRole ?? {}) },
        {
          title: "By standing",
          counts: { Active: users?.active ?? 0, Deactivated: users?.inactive ?? 0 },
        },
      ]}
      series={
        users ? { title: "Accounts created, by month", points: users.createdMonthly, valueHeader: "Accounts" } : null
      }
    />
  );
}
