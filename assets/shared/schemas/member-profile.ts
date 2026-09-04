/**
 * The member-profile resources a person's record page reads: the skills they
 * are vouched for, what they are open to, and the standing they have earned.
 *
 * Three nested resources rather than one blob, because they are governed
 * differently — skills are vouched by other members, availability is edited by
 * the person alone and is visibility-controlled, standing is awarded by the
 * system and never edited by hand.
 *
 * Every instant is ISO-8601 UTC. `availableFrom` is deliberately a calendar
 * date: "available from Q1 2027" must not shift by a timezone.
 */
import { z } from "zod";

import { userIdParamsSchema, utcInstantSchema } from "./api-common";

/* ── Skills ─────────────────────────────────────────────────────────────── */

export const memberSkillSchema = z.object({
  skillId: z.string(),
  slug: z.string(),
  name: z.string(),
  /** How many other members have vouched for it. */
  vouchCount: z.number().int().nonnegative(),
  /** Whether the member reading this record is one of them. */
  vouchedByViewer: z.boolean(),
});

export const memberSkillsResponseSchema = z.object({
  skills: z.array(memberSkillSchema),
  /** Vouches across every skill, which is the figure the panel heading shows. */
  totalVouches: z.number().int().nonnegative(),
});

/* ── Availability ───────────────────────────────────────────────────────── */

/**
 * Who may see what someone is open to. Evolvable policy, enforced here rather
 * than by a table constraint.
 */
export const availabilityVisibilitySchema = z.enum(["members", "private"]);

export const memberAvailabilitySchema = z.object({
  openToEmployment: z.boolean(),
  openToContract: z.boolean(),
  /** The roles sought, when open to employment. */
  rolesSought: z.string().nullable(),
  /** The services offered, when available for contract work. */
  servicesOffered: z.string().nullable(),
  note: z.string().nullable(),
  // A calendar date, not an instant: it must not shift by a timezone.
  availableFrom: z.iso.date().nullable(),
  visibility: availabilityVisibilitySchema,
  updatedAt: utcInstantSchema,
});

/**
 * Null when the person has said nothing, or when the viewer may not see it.
 * The two are deliberately indistinguishable to the caller: "private" must not
 * leak that there is something to hide.
 */
export const memberAvailabilityResponseSchema = z.object({
  availability: memberAvailabilitySchema.nullable(),
});

/* ── Standing ───────────────────────────────────────────────────────────── */

export const memberRecognitionSchema = z.object({
  key: z.string(),
  label: z.string(),
  awardedAt: utcInstantSchema,
});

export const memberStandingSchema = z.object({
  points: z.number().int(),
  /**
   * 0 when the ladder is empty — every band deactivated. A misconfigured
   * ladder is a real state and must be representable, or a configuration
   * mistake becomes a 500 on somebody's profile.
   */
  level: z.number().int().nonnegative(),
  levelName: z.string(),
  nextLevelAt: z.number().int().nullable(),
  pointsToNextLevel: z.number().int().nullable(),
  recognitions: z.array(memberRecognitionSchema),
});

export const memberStandingResponseSchema = z.object({
  standing: memberStandingSchema,
});

export type MemberSkill = z.infer<typeof memberSkillSchema>;
export type MemberAvailability = z.infer<typeof memberAvailabilitySchema>;
export type MemberStanding = z.infer<typeof memberStandingSchema>;

/* ── Writes ─────────────────────────────────────────────────────────────── */

/** Addresses one claimed skill on one person's record. */
export const memberSkillParamsSchema = userIdParamsSchema.extend({
  skillId: z.string().min(1),
});

/* ── Routes ─────────────────────────────────────────────────────────────── */

export const memberSkillVouchRouteSchema = {
  tags: ["Users"],
  summary: "Vouch for a skill on a member's record",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: memberSkillParamsSchema },
  responses: {
    "200": {
      description: "The skill, with the vouch counted.",
      content: { "application/json": { schema: memberSkillsResponseSchema } },
    },
    "401": { description: "Authorization required." },
    "403": { description: "You may not vouch for this skill." },
    "404": { description: "User or claimed skill not found." },
  },
};

export const memberSkillVouchWithdrawRouteSchema = {
  tags: ["Users"],
  summary: "Withdraw a vouch",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: memberSkillParamsSchema },
  responses: {
    "200": {
      description: "The skill, with the vouch removed.",
      content: { "application/json": { schema: memberSkillsResponseSchema } },
    },
    "401": { description: "Authorization required." },
    "404": { description: "User or claimed skill not found." },
  },
};

export const memberAvailabilityUpdateSchema = z.object({
  openToEmployment: z.boolean(),
  openToContract: z.boolean(),
  rolesSought: z.string().max(300).nullable(),
  servicesOffered: z.string().max(300).nullable(),
  note: z.string().max(500).nullable(),
  availableFrom: z.iso.date().nullable(),
  visibility: availabilityVisibilitySchema,
});

export const memberAvailabilityUpdateRouteSchema = {
  tags: ["Users"],
  summary: "Set what a member is open to",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: {
    params: userIdParamsSchema,
    body: { content: { "application/json": { schema: memberAvailabilityUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "The stored availability.",
      content: { "application/json": { schema: memberAvailabilityResponseSchema } },
    },
    "401": { description: "Authorization required." },
    "404": { description: "User not found." },
  },
};

export const memberSkillsRouteSchema = {
  tags: ["Users"],
  summary: "Get a member's vouched skills",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "Claimed skills with their vouch counts.",
      content: { "application/json": { schema: memberSkillsResponseSchema } },
    },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
  },
};

export const memberAvailabilityRouteSchema = {
  tags: ["Users"],
  summary: "Get what a member is open to",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "Availability, or null when unset or not visible to the viewer.",
      content: { "application/json": { schema: memberAvailabilityResponseSchema } },
    },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
  },
};

export const memberStandingRouteSchema = {
  tags: ["Users"],
  summary: "Get a member's standing",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "Points, the level they place at, and recognitions held.",
      content: { "application/json": { schema: memberStandingResponseSchema } },
    },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
  },
};
