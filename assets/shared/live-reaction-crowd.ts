/**
 * Live reactions count people, not clicks. The room keeps, per reaction, the
 * people who reacted within a rolling window: a person's first reaction in
 * that window floats on air, repeats add nothing. Outputs keep the floats
 * few and faint and let an optional count carry the size of the crowd.
 */
export const LIVE_REACTION_CROWD_POLICY = {
  /** A person counts once per reaction while their latest reaction is this recent. */
  peopleWindowSeconds: 10,
  /** The crowd count shows from this many people on one reaction within the window. */
  countFromPeople: 5,
  /** The count fades this long after people stop reacting. */
  countHoldSeconds: 5,
  /** At most this many reactions float on an output at once. */
  maxFloating: 12,
} as const;
