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

{{< pqcmm-criteria level="0" >}}

Note: Possessing an SBOM, CBOM, or an internal PQC risk assessment does not elevate a product beyond Level 0 on its own. While these artifacts are highly valuable for planning, a vendor can have all of them and still be in the very early stages of their quantum readiness journey with no actual quantum-safe implementation. Their presence or absence is recorded as separate risk indicators in the [Supplier Intake Questions](#supplier-intake-questions) below.

## Using Level 0

> Level 0 is a **self-declared starting point**, not an assessed state. There is nothing to verify — if a product has no PQC implemented, no evidence collection is needed to establish that fact. A vendor can legitimately self-declare Level 0 without any formal assessment process.
{.callout-info}

A formal assessment only begins when a vendor claims to have reached Level 1 or higher. At that point, the questions on the [Level 1 page](/wg/pqc/pqcmm/levels/1-initial/) apply.

## Supplier Intake Questions

{{< pqcmm-assessment-questions level="0" >}}


## Suggested Procurement Actions

- Request a vendor roadmap commitment: by what date will Level 1 be achieved?
- Evaluate whether compensating controls (network-layer PQC, hybrid protocols) can bridge the gap.
- Consider product lifespan against harvest-now-decrypt-later timelines.
- Flag in your cryptographic risk register; assign a review cadence.
