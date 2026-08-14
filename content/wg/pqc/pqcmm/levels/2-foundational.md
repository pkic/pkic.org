---
date: 2026-05-07T00:00:00Z
linkTitle: "2 — Foundational"
title: "Level 2 (Foundational) - PQC Maturity Model (PQCMM)"
description: A product at Level 2 has quantum-safe algorithms supported in core functionality and is production-ready, with demonstrated compatibility with relevant standards.
summary: Level 2 means PQC is production-ready and standards-compliant. This is the minimum threshold for new production deployments.

weight: 30
sectionNav: true
---

## What Level 2 Means

A product at **Level 2** has moved beyond evaluation and into production. Quantum-safe algorithms are supported in the product's core functionality, are stable, and conform to recognised standards. Organizations can deploy quantum-safe configurations with reasonable confidence.

This level is the **minimum acceptable baseline** for new production deployments where long-term data confidentiality or integrity matters — particularly for systems with a service life extending beyond the anticipated availability of cryptographically relevant quantum computers.

> Level 2 is the **production floor**. Any new procurement for a system with a long lifespan should require at minimum Level 2 from the vendor.
{.callout-info}

## Criteria

{{< pqcmm-criteria level="2" >}}

Level 2 does **not** require full cryptographic inventory, crypto agility, or the feature to be enabled by default.

> **Why no cryptographic inventory at Level 2?**
>
> Level 2 deliberately prioritises time-to-market and accessibility — a vendor can reach Level 2 by demonstrating a standards-conformant PQC implementation in a released build, without committing to the inventory and agility discipline required at [Level 3](/wg/pqc/pqcmm/levels/3-advanced/).
>
> This trade-off has a cost: at Level 2, a buyer cannot independently verify the product's full cryptographic surface area, including third-party and dependency cryptography. The cryptographic inventory and SBOM at Level 3 are the **primary differentiators** between the two levels (alongside crypto agility), and they are a meaningful lift for the vendor.
>
> Buyers in regulated industries, or where supply-chain visibility is itself a procurement requirement (e.g., banking, healthcare, critical infrastructure, identity and trust services), should set the **minimum acceptable** procurement floor at Level 3, not Level 2 — see the [Setting Minimum Requirements](/wg/pqc/pqcmm/adoption/procurement/#setting-minimum-requirements) table. Level 2 remains useful as an entry signal but is not, by itself, a sufficient basis for crypto-asset visibility.
{.callout-info}

## Assessment Questions

{{< pqcmm-assessment-questions level="2" >}}


## Evidence Checklist

{{< pqcmm-evidence-checklist level="2" >}}


## Suggested Procurement Actions

- Require Level 2 as a minimum for any new production procurement on systems with a service life beyond 5–7 years.
- Verify standard conformance claims against publicly available test results.
- Evaluate the gap to Level 3 for systems where ongoing cryptographic visibility and agility are required.
