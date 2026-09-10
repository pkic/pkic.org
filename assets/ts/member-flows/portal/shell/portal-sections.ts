/**
 * Where each portal section's code lives.
 *
 * One list, split out of `PortalShell` when the shell crossed its line
 * budget: which module a section is in is a fact about the codebase's layout,
 * and the shell is about which address shows which section. Every one is
 * `lazy`, so a reader only downloads the sections they open.
 */
import { lazy } from "preact/compat";

export const MyOrganization = lazy(() =>
  import("../sections/MyOrganization").then((module) => ({ default: module.MyOrganization })),
);
export const Groups = lazy(() => import("../sections/Groups").then((module) => ({ default: module.Groups })));
export const Home = lazy(() => import("../sections/Home").then((module) => ({ default: module.Home })));
export const Participation = lazy(() =>
  import("../sections/Participation").then((module) => ({ default: module.Participation })),
);
export const MyApplications = lazy(() =>
  import("../sections/MyApplications").then((module) => ({ default: module.MyApplications })),
);
export const AccountSettings = lazy(() =>
  import("../sections/AccountSettings").then((module) => ({ default: module.AccountSettings })),
);
export const Forms = lazy(() => import("../sections/Forms").then((module) => ({ default: module.Forms })));
export const DonationAnalytics = lazy(() =>
  import("../sections/system-donations/DonationAnalytics").then((module) => ({ default: module.DonationAnalytics })),
);
export const EventAnalytics = lazy(() =>
  import("../sections/system-analytics/EventAnalytics").then((module) => ({ default: module.EventAnalytics })),
);
/*
 * The subject analytics pages (#39). One module, because they are three
 * configurations of one page — a reader who opens one has effectively
 * downloaded the others.
 */
export const MembershipAnalytics = lazy(() =>
  import("../sections/system-analytics/SubjectAnalyticsPages").then((module) => ({
    default: module.MembershipAnalytics,
  })),
);
export const OrganizationAnalytics = lazy(() =>
  import("../sections/system-analytics/SubjectAnalyticsPages").then((module) => ({
    default: module.OrganizationAnalytics,
  })),
);
export const UserAnalytics = lazy(() =>
  import("../sections/system-analytics/SubjectAnalyticsPages").then((module) => ({ default: module.UserAnalytics })),
);
export const SettingsSection = lazy(() =>
  import("../sections/settings/SettingsSection").then((module) => ({ default: module.SettingsSection })),
);
export const GroupWorkspace = lazy(() =>
  import("../sections/management/GroupWorkspace").then((module) => ({ default: module.GroupWorkspace })),
);
export const DonationDetailPage = lazy(() =>
  import("../sections/system-donations/DonationDetailPage").then((module) => ({ default: module.DonationDetailPage })),
);
export const Donations = lazy(() =>
  import("../sections/system-donations/Donations").then((module) => ({ default: module.Donations })),
);
export const Users = lazy(() => import("../sections/system-users/Users").then((module) => ({ default: module.Users })));
export const Organizations = lazy(() =>
  import("../sections/system-organizations/Organizations").then((module) => ({ default: module.Organizations })),
);
export const OrganizationDetail = lazy(() =>
  import("../sections/system-organizations/OrganizationDetail").then((module) => ({
    default: module.OrganizationDetail,
  })),
);
export const MembershipApplications = lazy(() =>
  import("../sections/membership-applications").then((module) => ({ default: module.MembershipApplications })),
);
export const Members = lazy(() =>
  import("../sections/membership-members").then((module) => ({ default: module.Members })),
);
export const RepresentedOrganizations = lazy(() =>
  import("../sections/RepresentedOrganizations").then((module) => ({ default: module.RepresentedOrganizations })),
);
export const SponsorWorkspace = lazy(() =>
  import("../sections/sponsors").then((module) => ({ default: module.SponsorWorkspace })),
);
