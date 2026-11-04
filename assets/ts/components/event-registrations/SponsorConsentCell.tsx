/** Keep the visual mark decorative and announce consent consistently in both registration rosters. */
export function SponsorConsentCell({ consent }: { consent: boolean | null | undefined }) {
  return (
    <>
      <span class={consent === true ? undefined : "pk-muted"} aria-hidden="true">
        {consent === true ? "✓" : "—"}
      </span>
      <span class="pk-sr-only">
        {consent === true ? "Consented to share with sponsors" : consent === false ? "No sponsor consent" : "Not asked"}
      </span>
    </>
  );
}
