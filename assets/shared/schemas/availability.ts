import { z } from "zod";

export const maintenanceWindowSchema = z
  .object({
    id: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    startsAt: z.iso.datetime({ precision: 3 }),
    endsAt: z.iso.datetime({ precision: 3 }),
    enabled: z.boolean().default(true),
    policy: z.enum(["notice", "pause"]),
    channels: z
      .array(z.enum(["http", "background", "email"]))
      .min(1)
      .max(3),
  })
  .refine((window) => window.endsAt > window.startsAt, { message: "End must be after start", path: ["endsAt"] });
export const maintenanceScheduleSchema = z
  .object({
    version: z.literal(1),
    windows: z.array(maintenanceWindowSchema).max(100),
  })
  .superRefine((schedule, ctx) => {
    const ids = new Set<string>();
    for (const [index, window] of schedule.windows.entries()) {
      if (ids.has(window.id))
        ctx.addIssue({ code: "custom", message: "Window IDs must be unique", path: ["windows", index, "id"] });
      ids.add(window.id);
    }
  });
export type MaintenanceWindow = z.infer<typeof maintenanceWindowSchema>;
export type MaintenanceChannel = MaintenanceWindow["channels"][number];

export const availabilitySchema = z.object({
  mode: z.enum(["normal", "maintenance", "emergency"]),
  message: z.string(),
  endsAt: z.iso.datetime({ precision: 3 }).nullable(),
  windows: z.array(maintenanceWindowSchema).default([]),
});
export type Availability = z.infer<typeof availabilitySchema>;
export const apiStatusSchema = z.object({
  name: z.string(),
  version: z.string(),
  docs: z.string(),
  status: z.enum(["ok", "unavailable"]),
  availability: availabilitySchema,
});
export const AVAILABILITY_ERROR_CODE = "SERVICE_UNAVAILABLE";
