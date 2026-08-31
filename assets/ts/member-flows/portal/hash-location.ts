/**
 * The portal's canonical location hook. Hash URLs carry an optional query
 * segment (`#/users?users.q=…`) holding URL-addressed list state; routing
 * and active-link comparisons must see only the path. This wrapper strips
 * the query from wouter's hash location and passes navigation through —
 * wouter's `navigate` rebuilds the hash wholesale, so state parameters
 * naturally drop when the route changes.
 *
 * The query segment itself is read and written by `useUrlTableState`; the
 * magic-link verify flow (`#/verify?token=…`) established this URL shape.
 */
import { useHashLocation } from "wouter/use-hash-location";

export function usePortalHashLocation(): ReturnType<typeof useHashLocation> {
  const [raw, navigate] = useHashLocation();
  return [raw.split("?", 1)[0], navigate];
}
