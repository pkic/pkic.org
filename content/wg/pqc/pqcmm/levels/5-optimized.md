---
date: 2026-05-07T00:00:00Z
linkTitle: "5 — Optimized"
title: "Level 5 (Optimized) - PQC Maturity Model (PQCMM)"
description: A product at Level 5 defaults to quantum-safe algorithms, meets performance benchmarks, follows NIST-approved standards, and uses independently verified cryptographic implementations.
summary: Level 5 is the gold standard — PQC is the default, performance is benchmarked, implementations are independently verified. The product is fully optimised for a post-quantum world.

weight: 60
sectionNav: true
---

## What Level 5 Means

A product at **Level 5** represents the most mature state of PQC readiness. Quantum-safe cryptography is not a configuration option — it is the **default behaviour**. Legacy algorithms exist only as an explicit opt-in for backward compatibility purposes, and the vendor has verified that the product meets performance requirements in its quantum-safe configuration.

At this level, the product's cryptographic components have undergone — or are built on — **independent verification or certification**, providing the highest level of assurance for critical deployments.

> Level 5 is the **end state** of the PQC readiness journey. It signals that a vendor has not merely added quantum-safe support — they have achieved a state of Cryptographic Agility and Cryptographic Resilience.
{.callout-info}

## Criteria

{{< pqcmm-criteria level="5" >}}

## Assessment Questions

{{< pqcmm-assessment-questions level="5" >}}


## Evidence Checklist

{{< pqcmm-evidence-checklist level="5" >}}


## Suggested Procurement Actions

- Verify FIPS 140-3 validation certificates directly with the vendor and via the CMVP database.
- Review benchmark results against your organisation's SLA requirements.
- Confirm that the "quantum-safe default" covers all use cases relevant to your deployment — some products default to quantum-safe for new sessions but retain classical for legacy connections.
- Use Level 5 as the benchmark for all new procurement in critical trust infrastructure roles.
