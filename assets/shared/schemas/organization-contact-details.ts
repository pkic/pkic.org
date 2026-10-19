import { z } from "zod";
import { countryCodeSchema } from "../countries";
import { jsonErrorResponse, normalizedEmailSchema, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { organizationManagementParamsSchema } from "./organization-management";

/** Postal parts stay reportable inside the private address JSON column. */
export const organizationPostalAddressSchema = z
  .object({
    lines: z.array(trimmedString(1, 200)).max(10),
    city: trimmedString(1, 200).nullable(),
    region: trimmedString(1, 200).nullable(),
    postalCode: trimmedString(1, 40).nullable(),
  })
  .strict()
  .transform((address) =>
    address.lines.length || address.city || address.region || address.postalCode ? address : null,
  )
  .nullable();
export type OrganizationPostalAddress = z.infer<typeof organizationPostalAddressSchema>;

export function parseOrganizationPostalAddressJson(raw: string | null): OrganizationPostalAddress {
  return organizationPostalAddressSchema.parse(raw === null ? null : JSON.parse(raw));
}

export function serializeOrganizationPostalAddress(address: OrganizationPostalAddress): string | null {
  const parsed = organizationPostalAddressSchema.parse(address);
  return parsed === null ? null : JSON.stringify(parsed);
}

/** Private organization channels, independent of the people representing it. */
export const organizationContactFieldsSchema = z.object({
  email: normalizedEmailSchema.nullable(),
  phone: trimmedString(1, 80).nullable(),
  postalAddress: organizationPostalAddressSchema,
  countryCode: countryCodeSchema.nullable(),
});

export const organizationContactDetailsSchema = organizationContactFieldsSchema.extend({
  revision: z.int().positive(),
  updatedAt: utcInstantSchema,
  updatedByUserId: databaseIdSchema,
});
export const organizationContactDetailsUpdateSchema = organizationContactFieldsSchema
  .extend({ revision: z.int().nonnegative() })
  .strict();
export const organizationContactDetailsResponseSchema = z.object({
  contactDetails: organizationContactDetailsSchema.nullable(),
});
export type OrganizationContactDetailsUpdate = z.infer<typeof organizationContactDetailsUpdateSchema>;
export type OrganizationContactDetails = z.infer<typeof organizationContactDetailsSchema>;

const responses = {
  "200": {
    description: "Private organization contact details; null when none have been saved.",
    content: { "application/json": { schema: organizationContactDetailsResponseSchema } },
  },
  "401": jsonErrorResponse("A human user session is required."),
  "403": jsonErrorResponse("Organization permission or a current primary or secondary contact is required."),
  "404": jsonErrorResponse("Organization not found for the acting identity."),
  "409": jsonErrorResponse("Contact details or authorization changed; reload before retrying."),
};
export const organizationContactDetailsGetRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Read private organization contact details",
  request: { params: organizationManagementParamsSchema },
  responses,
};
export const organizationContactDetailsPutRouteSchema = {
  ...organizationContactDetailsGetRouteSchema,
  summary: "Save private organization contact details without content review",
  request: {
    params: organizationManagementParamsSchema,
    body: { content: { "application/json": { schema: organizationContactDetailsUpdateSchema } }, required: true },
  },
  responses: { ...responses, "400": jsonErrorResponse("Invalid contact details.") },
};
