import { signal } from "@preact/signals";
import { availabilitySchema, type Availability } from "../../shared/schemas/availability";

export const serviceAvailability = signal<Availability | null>(null);
export function publishAvailability(value: unknown): void {
  const parsed = availabilitySchema.safeParse(value);
  if (parsed.success) serviceAvailability.value = parsed.data;
}
