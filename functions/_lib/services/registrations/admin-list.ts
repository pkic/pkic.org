/**
 * @deprecated Admin routes retain these aliases while they are migrated to
 * the shared event-registration read model.
 */
export {
  buildEventRegistrationsPageQuery as buildAdminEventRegistrationsPageQuery,
  listEventRegistrations as listAdminEventRegistrations,
  type EventRegistrationsListResult,
  type EventRegistrationsListResult as AdminEventRegistrationsListResult,
} from "./event-registrations";
