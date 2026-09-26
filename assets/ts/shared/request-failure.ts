/** Only temporary failures may retain an already authorized, same-resource view. */
export function canRetainData(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    [0, 502, 503, 504].includes(error.status)
  );
}
