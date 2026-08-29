function segment(value: string): string {
  return encodeURIComponent(value);
}

export function eventRegistrationsPath(eventSlug: string): string {
  return `/api/v1/events/${segment(eventSlug)}/registrations`;
}

export function eventRegistrationPath(eventSlug: string, registrationId: string): string {
  return `${eventRegistrationsPath(eventSlug)}/${segment(registrationId)}`;
}

export function eventRegistrationResourcePath(
  eventSlug: string,
  registrationId: string,
  resource: "access" | "admissions" | "audit" | "badge" | "notifications",
): string {
  return `${eventRegistrationPath(eventSlug, registrationId)}/${resource}`;
}

export function eventRegistrationExportsPath(eventSlug: string): string {
  return `${eventRegistrationsPath(eventSlug)}/exports`;
}

export function eventRegistrationPromotionsPath(eventSlug: string): string {
  return `${eventRegistrationsPath(eventSlug)}/promotions`;
}

export function eventRegistrationViewPath(eventSlug: string, registrationId: string): string {
  return `${eventRegistrationsViewPath(eventSlug)}/${segment(registrationId)}`;
}

export function eventRegistrationsViewPath(eventSlug: string): string {
  return `/events/${segment(eventSlug)}/registrations`;
}
