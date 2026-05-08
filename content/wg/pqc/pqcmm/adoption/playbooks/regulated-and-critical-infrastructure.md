---
date: 2026-05-07T00:00:00Z
linkTitle: "Regulated & Critical"
title: "Regulated and Critical Infrastructure Playbook - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: Additional considerations for regulated sectors, critical infrastructure, public trust, and high-assurance use cases adopting the Post-Quantum Cryptography Maturity Model.
summary: Apply stronger gates, independent assurance, audit-ready evidence, exception expiry, and supplier replacement planning for regulated and critical infrastructure use cases.
weight: 40
---

## Add Stronger Assurance Where Consequences Are Higher

Regulated sectors and critical infrastructure buyers should apply the same model with stricter thresholds, stronger evidence requirements, and shorter review cycles. The ultimate goal is moving these critical suppliers to **Level 5 (Optimized)**.

The model helps keep the requirement understandable while still supporting formal procurement controls.

## Continuous Prioritization

- **Survey the ecosystem**: Embed PQCMM assessment requests into all procurement and regulatory-compliance vendor surveys.
- **Chase the critical path**: Prioritize immediate follow-ups with the vendors providing the backbone of your operations (e.g., core banking systems, SCADA/ICS networks, PKI components, cloud backbones, HSMs, and identity providers).
- **Mandate independence**: Determine which product categories mandate third-party assessment or PKI Consortium certification. Update procurement policies to block new contracts that lack this independent assurance.
- **Mitigate HNDL immediately**: Regulated and critical infrastructure data often has a multi-decade lifespan. [Level 0](/wg/pqc/pqcmm/levels/0-none/) suppliers protecting this data expose the organization to **Harvest Now, Decrypt Later (HNDL)** attacks. This requires immediate architectural isolation, compensating controls, or accelerated vendor replacement.
- **Set formal milestones**: Use the lower PQCMM levels to track verifiable progress. Re-evaluate supplier compliance annually or after major changes.

## Additional Considerations

| Area | Recommended control |
|---|---|
| Minimum level | Use Level 3 or higher for systems with long-lived sensitive data or high operational dependency |
| Assurance | Require third-party assessment or certification where policy, regulation, or risk posture requires it |
| Evidence | Require report scope, criteria matrix, software bill of materials, cryptographic bill of materials, and reassessment triggers |
| Exceptions | Require named risk owner, expiry date, compensating controls, and replacement plan if remediation fails |
| Reporting | Track maturity and exceptions at executive, audit, or programme governance level |

## Common High-Assurance Use Cases

- Public trust and certificate issuance infrastructure.
- Root, intermediate, and issuing certificate authority systems.
- Hardware security modules and key-management platforms.
- Code signing, firmware signing, and secure update services.
- Payment, healthcare, identity, government, or critical public infrastructure.
- Products protecting data that must remain confidential for many years.

## Minimum Policy

Use pass/fail eligibility gates before scoring. Do not use a roadmap to satisfy a mandatory current-level requirement unless a formal exception is approved. For suppliers that remain below the required level across repeated review cycles, start remediation escalation or replacement planning.

