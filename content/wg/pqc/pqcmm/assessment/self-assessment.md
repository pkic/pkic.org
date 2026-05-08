---
date: 2026-05-07T00:00:00Z
linkTitle: "Self-Assessment"
title: "Self-Assessment - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A self-assessment lets vendors and procuring organizations quickly determine the PQCMM maturity level of a product using the criteria and assessment questions defined for each level.
summary: Use the per-level criteria and assessment questions to determine the PQCMM maturity level of a product without external involvement.
weight: 10
---

## What Is a Self-Assessment?

A self-assessment is performed by the vendor themselves, or by a procuring organization evaluating a supplier's product. It uses the criteria and assessment questions defined for each [maturity level](/wg/pqc/pqcmm/levels/) to arrive at a level rating.

Self-assessments are fast, low-cost, and suitable as a starting point — for example, as a response to a supplier questionnaire, a request for proposal, or an internal post-quantum cryptography gap analysis.

> A self-assessment is **indicative**, not authoritative. It reflects the vendor's own view of their product and is not independently verified. Relying parties should treat self-assessed PQCMM levels as a useful signal, not a guarantee.
{.callout-info}

## How to Perform a Self-Assessment

1. **Select the product or service in scope.** A PQCMM assessment applies to a single product or service. Assess each separately.

2. **Start at [Level 0](/wg/pqc/pqcmm/levels/0-none/).** Work upward through the levels. A product achieves a level only if it meets **all criteria** for that level and all levels below it.

3. **Gather evidence (The exact same guidance as a Third-Party).** A credible self-assessment is not just a checklist of "yes" answers; it requires collecting the exact same evidence that a third-party assessor would demand. When answering the assessment questions, you must follow the **Assessment guidance** provided in the [level detail pages](/wg/pqc/pqcmm/levels/). This guidance explicitly states what constitutes acceptable evidence (e.g., specific release notes, public FIPS certificates, specific configuration settings). Vague marketing claims or undocumented future plans do not satisfy PQCMM criteria. Document your answers — "Yes", "No", or "Partial" with a brief explanation and links to the evidence.

4. **Identify the highest fully-met level.** The PQCMM level is the highest level where all criteria are met. A partial match at a level means the product does not yet achieve that level.

5. **Document the evidence.** For each criterion, note the evidence that supports your answer — configuration screenshots, documentation links, changelog entries, or engineering notes. This evidence will be required if you later engage a third-party assessor or pursue PKI Consortium certification.

6. **Record the result.** Document the assessed level, the assessment date, and any criteria that were partially met (to inform the roadmap to the next level).

## Sharing Self-Assessment Results

Self-assessment results can be shared with customers or procurement teams as a **declaration of PQCMM level**. A self-assessed claim must always be accompanied by supporting evidence — without evidence, it is an unsupported marketing claim and not a PQCMM self-assessment.

When sharing, include:

- The product name and version assessed.
- The assessed PQCMM level.
- The date of the assessment.
- The **evidence package** supporting the claim: for each criterion at the claimed level and all lower levels, the artefact(s) (release notes URL, configuration guide reference, SBOM/CBOM file, test results, etc.) that substantiate the answer. The evidence package must be available to recipients of the declaration on request.
- A summary of the criteria met and any notable gaps at the next level.
- A caveat that the assessment is self-declared and has not been independently verified.

Recipients should treat any self-assessed PQCMM level claim that is not accompanied by an evidence package as unsupported.

## Limitations

| Limitation | Mitigation |
|---|---|
| No independent verification | Engage a [third-party assessor](/wg/pqc/pqcmm/assessment/third-party/) for independent validation |
| Potential for overstatement | Be conservative: if a criterion is partially met, do not claim the level |
| Point-in-time snapshot | Re-assess after each significant product release |

