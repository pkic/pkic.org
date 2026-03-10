export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

export function addHours(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString();
}

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}
