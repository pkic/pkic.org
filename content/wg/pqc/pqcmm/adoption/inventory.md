---
date: 2026-05-07T00:00:00Z
linkTitle: "Inventory"
title: "Inventory and Governance - PQC Maturity Model (PQCMM)"
description: How to build and operate a PQC Maturity Model supplier inventory, evaluate already contracted products, and manage compliance exceptions.
summary: Maintain an organization-wide supplier inventory that evaluates existing products as well as new ones. Track risk tier, downstream assessments, exceptions, and remediation commitments.
weight: 40
---

## Managing Your Supply Chain Baseline

Evaluating new vendors is only half the battle. Organizations must also establish a clean inventory of **already contracted products, services, and vendors** (your supply chain, vendors, and the vendors of your vendors).

You don't have long to build this baseline. Apply the PQCMM to your entire supply chain to gain awareness. Reporting existing vendors at [Level 0](/wg/pqc/pqcmm/levels/0-none/) might not result in an immediate contract termination, but it gives you insight—*now you know your risk.*

## Supplier Risk Tiers

Before building the inventory, decide how each supplier is tiered. A supplier's risk tier is determined by the **impact of compromise** and the **exposure of the integration in your environment** — not by whether the product is labelled "cryptographic". Almost every modern product depends on cryptography somewhere; listing cryptographic product categories tends to be ignored by the wider audience this model is intended to reach.

| Tier | When to apply it |
|---|---|
| Low | Limited blast radius on failure; data is non-sensitive or short-lived; the product is easily replaced or isolated; downstream dependencies are minimal. |
| Moderate | Failure causes meaningful operational disruption or affects moderate-sensitivity data; replacement requires planning; the product is integrated with other business systems but is not on the critical path. |
| High | The product is on a critical path, carries mass user impact on failure, holds regulated or long-lived sensitive data, materially affects safety or trust, or is hard to replace within the relevant migration window. |

The same product can fall into different tiers in different organizations — and even into different tiers across deployments within the same organization. Assess **your own integration and exposure**, not the product label. Organizations operating in regulated sectors or with government-grade assurance obligations should treat the High tier as the floor for that scope, and apply additional sector-specific controls on top of the cadence and assurance expectations below.

This tier is recorded against every supplier in the inventory below and drives the [Review Cadence](#review-cadence), the [Assurance expectation](/wg/pqc/pqcmm/adoption/procurement/#setting-minimum-requirements) in procurement, and the threshold for exception escalation.

## Supplier Inventory

Once vendor responses are collected, record them in a PQC Maturity Model (PQCMM) supplier inventory. The inventory turns individual assessments into supply-chain visibility.

[Download a supplier inventory template](../downloads/pqcmm-supplier-inventory-template.csv) and adapt it to your procurement, vendor-risk, or governance tooling.

| Field | Example |
|---|-----|
| Supplier | Acme Corp |
| Product / service | SecureSign HSM 3.x |
| Business owner | Trust Services Platform Owner |
| Risk owner | CISO or delegated crypto risk owner |
| Risk tier | High (see [Supplier Risk Tiers](#supplier-risk-tiers)) |
| Data lifespan | 10+ years |
| Current PQCMM level | 2 |
| Assesses Downstream? | Yes (using PQCMM) |
| Required PQCMM level | 4 |
| Assurance method | Self-assessed |
| Report date | 2026-04-15 |
| Report scope | Version 3.2, FIPS mode, on-prem deployment |
| Evidence status | Complete / partial / missing |
| Software bill of materials status | Current / stale / not provided / not required |
| Cryptographic bill of materials status | Current / stale / not provided / not required |
| Next target level | Level 3 by Q4 2026 |
| Exception status | Approved until 2027-03-31 |
| Next reassessment | 2027-04-15 |
| Risk notes | No CBOM; hybrid support planned |

## Ownership Model

Define ownership clearly so the inventory remains active:

| Role | Responsibility |
|---|-----|
| Procurement | Includes PQCMM requirements in sourcing events and renewals |
| Vendor risk management | Maintains supplier records and follows up on evidence |
| Security architecture or cryptography team | Reviews technical evidence and criteria interpretation |
| Business owner | Accepts operational impact and prioritizes remediation |
| Risk owner | Approves exceptions and escalation for critical suppliers |
| Legal or contracts | Adds level commitments, reassessment triggers, and remedies |

Small organizations may combine several roles. Enterprise and government programmes should separate review, approval, and exception authority.

## Reassessment Triggers

Reassess a supplier when any of the following occurs:

- Major product version or platform release.
- Cryptographic library, algorithm, protocol, key-management, or signing-flow change.
- Deployment model change, such as on-premises to SaaS or single-tenant to multi-tenant.
- Security incident affecting cryptographic implementation or supply-chain integrity.
- New NIST, IETF, ETSI, ISO, regulatory, or sector requirement that affects the product.
- Contract renewal, material expansion, or a use case that moves the supplier into a higher [risk tier](#supplier-risk-tiers).
- Evidence or assessment report becomes stale under your policy.
- Change of control of the supplier, such as merger, acquisition, divestiture, or transfer of the product line to a new entity — reassess even if the product version has not changed, because the assessor, ownership, and roadmap commitments may have changed materially.
- Mixed-maturity integration, such as joining a Level 4 trust service to a Level 2 application or routing data between products at materially different levels — reassess both ends and record the effective maturity of the combined data flow.

## Exception Governance

Exceptions are sometimes necessary, especially while the market matures. They should be controlled:

| Exception element | Required content |
|---|-----|
| Gap | Required level, actual level, and missing criteria |
| Risk | Why the gap matters for the product and use case |
| Compensating controls | Isolation, hybrid controls, shortened data retention, alternative supplier, or monitoring |
| Owner | Named business owner and risk owner |
| Date | Approval date and expiry date |
| Milestone | Target level and evidence required by a specific date |
| Escalation | Trigger for leadership review or replacement planning |

## Metrics for Leadership

Useful executive metrics include:

- Percentage of in-scope suppliers with a current PQCMM record.
- Distribution of suppliers by PQCMM level.
- Distribution of suppliers by assurance method.
- Number of critical suppliers below required level.
- Number and age of approved exceptions.
- Percentage of suppliers with current SBOM or CBOM evidence where required.
- Roadmap commitments due in the next 90, 180, and 365 days.

## Record Keeping

The PQCMM simplifies traditional evidence handling. When relying on a [Third-Party Assessment](/wg/pqc/pqcmm/assessment/third-party/) or [Certification](/wg/pqc/pqcmm/assessment/certification/), the only "evidence" you typically need to retain is the authenticated assessment report itself. 

You no longer need to collect, secure, and evaluate highly sensitive technical artefacts like Cryptographic Bills of Materials (CBOMs) or architectural diagrams—the independent assessor handles that.

For your inventory, simply record the metadata of the assessment:

| Record type | Minimum information to keep |
|---|-----|
| Public documentation | URL, product version covered, date accessed |
| Assessment report | Report title, date, PQCMM version, assessor/certifier, and storage location of the verified PDF |
| Certification link | URL to the [Certified Products](/wg/pqc/pqcmm/products/) listing on the PKIC website |

*Note: If you are accepting a Self-Assessment for a higher risk tier, your organization may still choose to collect sensitive underlying evidence (like CBOMs or test reports) under NDA. In these cases, use your standard secure data room or GRC evidence-handling procedures.*

## Review Cadence

Review cadence is driven by the [risk tier](#supplier-risk-tiers) assigned to the supplier:

| Risk tier | Suggested review cadence |
|---|-----|
| Low | Annual or at renewal. |
| Moderate | Annual, plus any reassessment trigger above. |
| High | Semi-annual or at each material release, plus any reassessment trigger above. Organizations with regulatory or government-grade assurance obligations should treat quarterly status reviews and formal reassessment at every material change as the floor for High-tier suppliers in that scope. |

