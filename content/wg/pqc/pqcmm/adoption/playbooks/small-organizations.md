---
date: 2026-05-07T00:00:00Z
linkTitle: "Small Organizations"
title: "Small Organization Playbook - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A lightweight adoption playbook for small organizations using the Post-Quantum Cryptography Maturity Model without building a large governance programme.
summary: |
    Start small: identify critical suppliers, require assessment reports for new purchases and renewals, record maturity levels, and review annually.
weight: 10
---

## Keep It Lightweight

Small organizations should not wait until they have a mature cryptography programme. Use the PQCMM to ask suppliers for the right evidence and keep a simple record of the answers.

## Continuous Prioritization

The long-term goal is for your entire supply chain to reach **[Level 5 (Optimized)](/wg/pqc/pqcmm/levels/5-optimized/)**. The intermediate levels serve as milestones to measure progress. Because reviewing every vendor takes time, use a continuous, prioritized approach:

- **Send the survey to everyone**: Make the assessment report a mandatory request for all new purchases and renewals.
- **Chase the critical few**: Identify the 10–25 suppliers that matter most and actively chase their assessment reports. Prioritize: identity providers, cloud infrastructure, virtual private networks (VPN), hardware security modules (HSM), certificate authorities, signing services, backup providers, email, payment gateways, and your most critical software-as-a-service (SaaS) providers.
- **Set a procurement floor**: Require [Level 2](/wg/pqc/pqcmm/levels/2-basic/) or a credible Level 2 roadmap for new production systems that use cryptography.
- **Mitigate HNDL risk**: Escalate [Level 0](/wg/pqc/pqcmm/levels/0-none/) suppliers immediately if they protect long-lived, regulated, or business-critical data. These systems expose you to **Harvest Now, Decrypt Later (HNDL)** attacks, where adversaries intercept and store encrypted data today to decrypt it when quantum computers become available.
- **Record and track**: Document the current level, assurance method, report date, evidence status, and next review date in your supplier inventory.

## Buy, Evaluate, Contract, Monitor

| Step | Practical action |
|---|---|
| Buy | Include a one-line requirement for a PQCMM assessment report in new purchases |
| Evaluate | Check product, version, claimed level, assurance method, and evidence status |
| Contract | Add a renewal or milestone date if the supplier is below the target level |
| Monitor | Review critical suppliers annually or at renewal |

## Minimum Policy

Self-assessment is usually acceptable for baseline visibility. Require third-party assessment only for suppliers that are business-critical, protect long-lived data, or provide trust infrastructure.

