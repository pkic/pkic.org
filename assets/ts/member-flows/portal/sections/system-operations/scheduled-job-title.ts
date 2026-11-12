/** A job's display name, derived from its stable key. */
export function scheduledJobTitle(jobKey: string): string {
  return jobKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bEc\b/g, "EC");
}
