/**
 * How a points total resolves to a standing band.
 *
 * The *bands themselves* are configuration, not code: they live in the
 * `standing_levels` reference table, because what counts as a Contributor is
 * the consortium's decision and a threshold compiled into a deployment cannot
 * be changed by the people who own it. This module holds only the resolution
 * rule, which does not change when the ladder does.
 */

export interface StandingLevel {
  /** 1-based band index, as a record shows it: "level 4". */
  level: number;
  name: string;
  /** Points at which this band begins. The highest band has no ceiling. */
  fromPoints: number;
}

export interface StandingPosition {
  points: number;
  level: number;
  levelName: string;
  /** Points at which the next band begins, or null at the top. */
  nextLevelAt: number | null;
  /** How many more points to reach it, or null at the top. */
  pointsToNextLevel: number | null;
}

/**
 * The band a total falls in, given the configured ladder.
 *
 * Sorts defensively rather than trusting the caller's order, so a band added
 * out of sequence in the table still resolves correctly.
 *
 * Two edge cases the table cannot prevent:
 *   - an empty ladder (every band deactivated) resolves to an unnamed level 0
 *     rather than throwing, because a misconfigured ladder must not take a
 *     record page down with it;
 *   - a negative total — corrections are negative awards — lands in the first
 *     band rather than in none: standing was reversed, not erased.
 */
export function standingFor(points: number, levels: readonly StandingLevel[]): StandingPosition {
  const bands = [...levels].sort((a, b) => a.fromPoints - b.fromPoints);
  if (bands.length === 0) {
    return { points, level: 0, levelName: "Unranked", nextLevelAt: null, pointsToNextLevel: null };
  }

  let current = bands[0];
  for (const band of bands) {
    if (points >= band.fromPoints) current = band;
  }
  const next = bands.find((band) => band.fromPoints > points) ?? null;

  return {
    points,
    level: current.level,
    levelName: current.name,
    nextLevelAt: next?.fromPoints ?? null,
    pointsToNextLevel: next ? next.fromPoints - points : null,
  };
}

/**
 * What each kind of contribution is worth.
 *
 * Attendance, authorship, review and chairing — never posting volume, which is
 * the one thing a points system reliably corrupts if it counts it.
 *
 * Still a constant: unlike the bands, these are applied at the moment an award
 * is written, so changing one must not silently restate history. Moving them
 * into data is a separate decision that needs a versioning story.
 */
export const STANDING_REASON_POINTS: Readonly<Record<string, number>> = {
  meeting_attended: 5,
  event_attended: 10,
  event_spoke: 40,
  document_authored: 60,
  document_reviewed: 20,
  group_chaired_term: 150,
};

/** Points for a reason, or 0 for one this policy does not recognize. */
export function pointsFor(reasonKey: string): number {
  return STANDING_REASON_POINTS[reasonKey] ?? 0;
}
