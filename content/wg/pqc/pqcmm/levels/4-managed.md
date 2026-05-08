---
date: 2026-05-07T00:00:00Z
linkTitle: "4 — Managed"
title: "Level 4 (Managed) - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A product at Level 4 maintains a Cryptographic Bill of Materials (CBOM), supports a zero-legacy configuration, and clearly documents hybrid and composite algorithm support.
summary: Level 4 adds a CBOM, zero-legacy capability, and explicit hybrid/composite support. Suitable for high-assurance and regulated environments.

weight: 50
sectionNav: true
---

## What Level 4 Means

A product at **Level 4** builds on the visibility and agility of Level 3, adding the precision of a **Cryptographic Bill of Materials (CBOM)**, a demonstrated ability to **disable all non-quantum-safe algorithms entirely** while remaining functional, and clarity about **hybrid and composite algorithm support**.

> Level 4 is the benchmark for **high-assurance deployments**. It provides both the documentation precision needed for compliance and the operational capability to enforce a fully quantum-safe configuration.
{.callout-info}

## Criteria

{{< criteria >}}
A product meets Level 4 when all Level 3 criteria are met, plus:

- A **Cryptographic Bill of Materials (CBOM)** is maintained, detailing each algorithm in use, key sizes, protocol contexts, and usage purposes.
- **Zero-Legacy Capability:** the product can be configured to disable **all** non-quantum-safe algorithms throughout the product — including in low-level components such as boot, firmware update signing, hardware-bound operations, and internal diagnostics — while remaining fully functional. *Zero legacy means zero legacy.* If a non-quantum-safe algorithm cannot be disabled in any in-scope component, the product does not meet Level 4 for that component, and an assessment must record this as a finding that caps the product's level.
- Symmetric and hash algorithms used to protect data with long-lived confidentiality or integrity requirements meet the parameter strengths recommended by NIST (or an equivalent national authority) for use beyond the anticipated availability of cryptographically relevant quantum computers.
- The vendor clearly documents whether **hybrid** (classical + quantum-safe combined) and/or **composite** (algorithm-fused) modes are supported, and in which contexts.
{{< /criteria >}}

## Assessment Questions

At Level 4, assessors must request and validate the CBOM directly — not just accept that one exists. The assessment must document how the CBOM was generated, how it was validated, and whether the assessor independently cross-checked it. Claims made solely on the basis of vendor documentation without any independent check must be flagged. **A complete Level 4 assessment must also work through all [Level 1](/wg/pqc/pqcmm/levels/1-initial/#assessment-questions), [Level 2](/wg/pqc/pqcmm/levels/2-basic/#assessment-questions), and [Level 3](/wg/pqc/pqcmm/levels/3-advanced/#assessment-questions) questions.**

### Assessment methodology record

The assessment report must record:

- **CBOM analysis** — whether vendor-provided or assessor-generated; tool name and version; generation method (automated CI pipeline / manual export / hybrid); date generated; product version covered.
- **SBOM-to-CBOM cross-check** — method used to verify every cryptographic library in the SBOM maps to at least one CBOM entry, and any gaps found.
- **Zero-legacy testing** — product version; configuration applied; test tool name and version; exact test command or procedure; outcome (classical connection rejected / accepted / untested).
- **Hybrid/composite verification** — whether the assessor tested interoperability with a reference implementation; if so: implementation name and version, and result.
- **Unverified claims** — flag each explicitly as *"vendor-stated, not independently verified"*.

> Any claim at Level 4 that was not independently tested must be explicitly flagged in the report.
{.callout-info}

### Cryptographic Bill of Materials (CBOM)

| # | Question | Assessment guidance |
|---|---|---|
| 4.1 | Does the vendor produce a CBOM for this product? Request it in machine-readable format (CycloneDX with `cryptoProperties` extension, or equivalent). | Record: format and schema version (CycloneDX 1.6+ supports full `cryptoProperties`), generation tool name and version (e.g., IBM Sonar crypto-analyzer, cdxgen with crypto extension, CycloneDX Maven/Gradle plugin), generation method (automated CI pipeline / manual export / hybrid), date generated, and product version covered. Perform an SBOM-to-CBOM cross-check: for each cryptographic library listed in the SBOM, verify that at least one algorithm entry appears in the CBOM. Record any library that is present in the SBOM but has no corresponding CBOM entry — each is a coverage gap. |
| 4.2 | Does the CBOM record algorithm, parameter set, key size, protocol context, and usage purpose per entry? | Validate a sample of at least five entries across different components. For each: record whether all fields are present — algorithm, parameter set (e.g., ML-KEM-768 not just "ML-KEM"), key size, protocol context, and usage purpose. Record the sampling method (which entries were checked and why). An entry reading "AES-256-GCM — TLS 1.3 record encryption — post-handshake" is complete. An entry reading "AES" or "ML-KEM" without parameter set and context is not — record it as a gap. |
| 4.3 | Does the CBOM cover third-party cryptographic libraries, listing which algorithms each library contributes? | A CBOM that lists "OpenSSL 3.3" without listing which OpenSSL algorithms are in active use is incomplete at Level 4. Check: does each third-party cryptographic library entry have child entries for specific algorithms? Record which libraries have algorithm-level entries and which have library-name entries only. Libraries with no algorithm-level entries must be flagged. |
| 4.4 | What tools and processes are used to generate and validate the CBOM? What are the known coverage gaps? | Request the vendor's CBOM generation process document. Record: tool(s) name and version, automation level (fully automated / manual / hybrid), whether the CBOM is generated per build or periodically, and the documented coverage gaps. Common gaps include: native code (C/C++) with statically compiled libraries, dynamically loaded plugins, hardware-bound cryptography, and firmware blobs. A vendor who cannot state how the CBOM was generated cannot have its accuracy independently assessed — record this as a fundamental evidence limitation. |

### Zero-Legacy Capability

| # | Question | Assessment guidance |
|---|---|---|
| 4.5 | Can the product be configured to disable all non-quantum-safe algorithms? Provide the exact configuration steps. | Record the exact configuration mechanism (configuration file key, API call, CLI flag, UI setting) and the documentation URL. Where possible, reproduce in a test environment: apply the zero-legacy configuration, then test using a client that supports only classical algorithms — e.g., `openssl s_client -cipher "AES256-SHA" -tls1_2 -connect host:port`. Record: test tool name and version, exact command used, product version, configuration applied, and outcome (connection rejected / accepted). A connection that succeeds under this test is a finding. |
| 4.6 | When configured in zero-legacy mode, does the product remain fully functional with a quantum-safe client? | Test with a representative quantum-safe workload. Record: test environment details, product version, zero-legacy configuration applied, quantum-safe client tool and version (e.g., OQS-OpenSSL, a TLS client with ML-KEM support), test procedure, and outcome. Document any feature that fails or degrades in zero-legacy mode — each exception must be named, scoped, and risk-assessed. |
| 4.7 | Are there components in which non-quantum-safe algorithms cannot be disabled — e.g., internal diagnostics, boot sequences, hardware-enforced algorithms, firmware update signing, or root-of-trust operations? | Zero legacy means zero legacy: any in-scope component in which a non-quantum-safe algorithm cannot be disabled is a finding that caps the product's PQCMM level below Level 4 for the affected component. Record each such component by: name, algorithm in use, reason it cannot be disabled, the vendor's planned remediation timeline, and the resulting effective maturity level for that component. The assessment report must clearly state where the product does and does not achieve zero-legacy operation. |

### Symmetric and Hash Strengths for Long-Lived Data

| # | Question | Assessment guidance |
|---|---|---|
| 4.7a | For data with long-lived confidentiality or integrity requirements (as identified in the HNDL exposure register at Level 3), do the symmetric and hash algorithms used meet the strengths recommended by NIST or an equivalent national authority for use beyond the anticipated availability of cryptographically relevant quantum computers? | Record, for each long-lived data class identified in the HNDL register: the symmetric algorithm and key length, the hash algorithm and output length, and the NIST or national-authority guidance referenced (e.g., NIST SP 800-131A, BSI TR-02102, ANSSI cryptographic recommendations). A long-lived data class protected with symmetric or hash strengths below the referenced guidance is a finding. |

### Hybrid and Composite Support

| # | Question | Assessment guidance |
|---|---|---|
| 4.8 | Does the product support hybrid key exchange or hybrid authentication? If yes, which specific hybrid schemes, and which standard or draft? | Record scheme-level specifics: e.g., X25519+ML-KEM-768 per draft-ietf-tls-hybrid-design (record the draft version number — implementations based on superseded drafts may not interoperate with current versions). "We support hybrid" without naming the scheme and draft version is not assessable. Where possible, test interoperability with a reference implementation (e.g., OQS-OpenSSL configured for the same scheme) and record: tool name and version, test command, and outcome. |
| 4.9 | Does the product support composite algorithms? If yes, which schemes and which standard or draft? | Record: scheme name (e.g., id-MLDSA65-RSA2048-PKCS15-SHA256), reference standard or draft (e.g., draft-ounsworth-pq-composite-sigs with specific draft version, or ETSI TS 119 312 with section reference). Proprietary composite schemes that deviate from published drafts must be flagged as an interoperability risk and recorded with the vendor's explanation of the deviation. |
| 4.10 | In which protocols, features, or configurations is hybrid/composite mode available? | Record each feature area with the specific hybrid/composite scheme implemented and a configuration example or documentation URL. "Full hybrid support" without a feature-level breakdown requires decomposition before recording. Request the specific configuration parameter or API call for each named feature. |

## Evidence Checklist

The items below are a level-specific summary of the artefacts a vendor should be able to produce. They can serve as a concise request list for an assessor, or as a self-assessment reference for a vendor preparing evidence before a formal assessment. The detailed requirements and acceptance criteria for each item are in the assessment questions above. All artefacts from [Level 1](/wg/pqc/pqcmm/levels/1-initial/#evidence-checklist), [Level 2](/wg/pqc/pqcmm/levels/2-basic/#evidence-checklist), and [Level 3](/wg/pqc/pqcmm/levels/3-advanced/#evidence-checklist) remain required.

- CBOM in CycloneDX format (with cryptography extension) or equivalent structured format.
- Configuration guide for enabling zero-legacy mode, including a list of any caveats.
- Technical documentation of hybrid and composite support with protocol/standard references.
- Test results or validation reports confirming zero-legacy operation.

## Suggested Procurement Actions

- Request the CBOM and validate it against your organisation's cryptographic policy.
- Confirm zero-legacy capability covers the specific features and protocols in your deployment scenario.
- Clarify hybrid/composite support before designing a hybrid migration architecture.
- Consider requiring Level 4 for certificate authorities, HSMs, identity providers, and other cryptographic root services.

