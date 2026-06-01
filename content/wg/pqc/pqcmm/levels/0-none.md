---
date: 2026-05-07T00:00:00Z
linkTitle: "0 — None"
title: "Level 0 (None) - PQC Maturity Model (PQCMM)"
description: A product at Level 0 has no post-quantum cryptography integrated into the product. The organization might be in the preparation phase, but nothing has matured to the actual product.
summary: Level 0 means no quantum-safe capabilities are available yet. Discovery and preparation may be underway, but this is the baseline entry point for supply-chain questionnaires.

weight: 10
sectionNav: true
---

## What Level 0 Means

A product at **Level 0** has no quantum-safe algorithm available in any release channel. The vendor may be fully aware of PQC requirements and actively planning migration — the level reflects implementation status only, not intent or awareness.

This level is not a failure — it is an honest, useful data point. Knowing a product is at Level 0 lets procurement teams:

- Include it in their PQC migration risk register.
- Set a clear expectation with the vendor for when Level 1 will be reached.
- Prioritise replacement or compensating controls based on the assessed risk and the shelf-life of the data and system.

> Level 0 is the **starting point of the journey**, not a disqualifying condition. Its value lies in visibility: organisations can only manage what they can measure.
{.callout-info}

## Criteria

{{< criteria >}}
A product is at Level 0 when the following are true:

- The quantum readiness journey has not yet started or is still in a very early phase.
- No quantum-safe algorithm is available in any release channel available to customers, including beta, preview, or experimental.
{{< /criteria >}}

Note: Possessing an SBOM, CBOM, or an internal PQC risk assessment does not elevate a product beyond Level 0 on its own. While these artifacts are highly valuable for planning, a vendor can have all of them and still be in the very early stages of their quantum readiness journey with no actual quantum-safe implementation. Their presence or absence is recorded as separate risk indicators in the [Supplier Intake Questions](#supplier-intake-questions) below.

## Using Level 0

> Level 0 is a **self-declared starting point**, not an assessed state. There is nothing to verify — if a product has no PQC implemented, no evidence collection is needed to establish that fact. A vendor can legitimately self-declare Level 0 without any formal assessment process.
{.callout-info}

A formal assessment only begins when a vendor claims to have reached Level 1 or higher. At that point, the questions on the [Level 1 page](/wg/pqc/pqcmm/levels/1-initial/) apply.

## Supplier Intake Questions

When onboarding a supplier or reviewing an existing product, the following questions help establish a baseline and set expectations for progression. These are not assessment questions — they do not require evidence collection or verification. They are planning and risk-register inputs.

| # | Question | Expected Input | Purpose |
|---|---|---|---|
| 1 | By what date do you expect to reach Level 1 — with at least one quantum-safe algorithm available for evaluation? | Date (YYYY-MM-DD). | Helps both the organization and the vendor set a concrete milestone for the supplier roadmap and ensures clear communication of the post-quantum cryptography (PQC) timeline. |
| 2 | Is a Software Bill of Materials (SBOM) or Cryptographic Bill of Materials (CBOM) available for this product in SPDX or CycloneDX format? | File upload or URL to the document. | Knowing the software and cryptographic components makes the eventual transition to higher PQC maturity levels faster and more secure. It helps both parties assess the current visibility into cryptographic assets. |
| 3 | Have you assigned a role or team responsible for the PQC migration of this product? | Role title or department name. | Ensures there is clear accountability and a point of contact for future PQC-related discussions. This reduces continuity risk during the quantum-safe transition. |
| 4 | Have you published a statement of direction or roadmap for PQC for this product? | URL to the roadmap or a document upload. | Confirms that PQC is actively being planned. A roadmap referencing specific standards (like NIST FIPS 203, 204, 205) provides confidence in the vendor's preparation and helps align planning. |

## Suggested Procurement Actions

- Request a vendor roadmap commitment: by what date will Level 1 be achieved?
- Evaluate whether compensating controls (network-layer PQC, hybrid protocols) can bridge the gap.
- Consider product lifespan against harvest-now-decrypt-later timelines.
- Flag in your cryptographic risk register; assign a review cadence.

