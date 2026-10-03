/** Approved immutable assessment bundles. Update integrity when adopting a new release. */
export const selfAssessmentReleases = {
  "v1.0.3": {
    sourceUrl: "https://pkic.github.io/self-assessment/v1.0.3/self-assessment.js",
    url: "/_published/assessment/v1.0.3/self-assessment.js",
    integrity: "sha384-EJHoWdfy3QfeCPviKo1SSNCA6cTejk5KDPNc6kQQb6MFnxaxxfqQu2kORfV5K5+r",
    licenseIntegrity: "sha384-A8kfRDlmwCzTppXYurYqi1y6ogeZfMVd4bC83auh4MnFlKt+qp5N5C00ymVeX0s7",
  },
  "v2.0.0": {
    sourceUrl: "https://pkic.github.io/self-assessment/v2.0.0/self-assessment.js",
    url: "/_published/assessment/v2.0.0/self-assessment.js",
    integrity: "sha384-m0O7PGIILT3hxVc500E7B9ophSb85NlVvZ57pOY1mccoAYgC6I1u1GPvrYOpO+y3",
    licenseIntegrity: "sha384-bg5Xp3dDY1n1kLnDc46T3wA6O71XMwqToyCiLm87zK/pjFwJQjrCtrBzbgVLcLOc",
  },
} as const;

export function selfAssessmentRelease(version: string | undefined) {
  if (!version || !Object.hasOwn(selfAssessmentReleases, version)) return undefined;
  return selfAssessmentReleases[version as keyof typeof selfAssessmentReleases];
}
