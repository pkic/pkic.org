---
date: 2026-05-07T00:00:00Z
linkTitle: "Inventory"
title: "Inventory and Governance - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: How to build and operate a Post-Quantum Cryptography Maturity Model supplier inventory, evaluate already contracted products, and manage compliance exceptions.
summary: Maintain an organization-wide supplier inventory that evaluates existing products as well as new ones. Track risk tier, downstream assessments, exceptions, and remediation commitments.
weight: 40
---

## Managing Your Supply Chain Baseline

Evaluating new vendors is only half the battle. Organizations must also establish a clean inventory of **already contracted products, services, and vendors** (your supply chain, vendors, and the vendors of your vendors).

You don't have long to build this baseline. Apply the PQCMM to your entire supply chain to gain awareness. Reporting existing vendors at [Level 0](/wg/pqc/pqcmm/levels/0-none/) might not result in an immediate contract termination, but it gives you insight—*now you know your risk.*

## Supplier Inventory

Once vendor responses are collected, record them in a Post-Quantum Cryptography Maturity Model (PQCMM) supplier inventory. The inventory turns individual assessments into supply-chain visibility.

[Download a supplier inventory template](../downloads/pqcmm-supplier-inventory-template.csv) and adapt it to your procurement, vendor-risk, or governance tooling.

| Field | Example |
|---|-----|
| Supplier | Acme Corp |
| Product / service | SecureSign HSM 3.x |
| Business owner | Trust Services Platform Owner |
| Risk owner | CISO or delegated crypto risk owner |
| Criticality | High |
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
- Contract renewal, material expansion, or new high-criticality use case.
- Evidence or assessment report becomes stale under your policy.

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

*Note: If you are accepting a Self-Assessment for a higher risk-tier, your organization may still choose to collect sensitive underlying evidence (like CBOMs or test reports) under NDA. In these cases, use your standard secure data room or GRC evidence-handling procedures.*

## Review Cadence

| Supplier tier | Suggested review cadence |
|---|-----|
| Low risk | Annual or at renewal |
| Moderate risk | Annual plus major-change triggers |
| High risk | Semi-annual or at each material release |
| Critical or government high assurance | Quarterly status review plus formal reassessment triggers |

