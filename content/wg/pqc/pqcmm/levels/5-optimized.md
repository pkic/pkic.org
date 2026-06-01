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

{{< criteria >}}
A product meets Level 5 when all Level 4 criteria are met, plus:

- Quantum-safe algorithms are the **default and preferred setting** for all relevant features; any legacy algorithm requires explicit enablement by the operator.
- Algorithms are **benchmarked and tuned**: the vendor has measured and documented that quantum-safe configurations meet or exceed operational performance requirements for the product's target environments.
- The product primarily follows post-quantum cryptography standards approved by a recognised national or international standards body (such as NIST, ETSI, or ISO/IEC), as applicable to the product's target markets. The PQCMM does not prescribe a specific algorithm or parameter set; see the [model's design principle on algorithm-neutral criteria](/wg/pqc/pqcmm/#design-principles).
- The cryptographic implementation is **independently verified or certified** — through FIPS 140 validation covering the PQC algorithms, an applicable Common Criteria evaluation whose Security Target includes the cryptographic implementation, or a widely scrutinised cryptographic library with a published, third-party formal security analysis specifically covering the implemented PQC algorithms. Where a library-based claim is made, the audit report submitted with the assessment must identify the library, version, the analysing organisation, and the analysis publication.
{{< /criteria >}}

## Assessment Questions

At Level 5, claims must be verified directly — not accepted on the vendor's word. Every significant claim requires either an independent public database check (CMVP, CAVP) or an assessor-performed test with a recorded outcome. **A complete Level 5 assessment must also work through all [Level 1](/wg/pqc/pqcmm/levels/1-initial/#assessment-questions), [Level 2](/wg/pqc/pqcmm/levels/2-basic/#assessment-questions), [Level 3](/wg/pqc/pqcmm/levels/3-advanced/#assessment-questions), and [Level 4](/wg/pqc/pqcmm/levels/4-managed/#assessment-questions) questions.**

### Assessment methodology record

The assessment report must record:

- **Default configuration** — whether the assessor performed a fresh installation test (product version, installation method, environment, and configuration captured) or relied on documentation only (flag as *"documentation review only, not independently reproduced"*).
- **Performance evidence** — benchmark report reference (title, date, hardware specification, test tool name and version, load profile); whether the assessor reviewed the methodology section or accepted results at face value.
- **FIPS/standards verification** — CMVP certificate URL and date checked; CAVP algorithm validation URL and date checked.
- **CBOM cross-check** — tool name and version; date run; number of entries sampled; findings.
- **Third-party audit** — report reference, audit firm name, and stated scope; whether the methodology section was reviewed, specifically: was the assessment CBOM-based, code-review-based, or both? Which tools were named?
- **Unverified claims** — flag each explicitly as *"vendor-stated, not independently verified"*.

> Any claim at Level 5 that is not independently verifiable via a public database or reproducible test must be explicitly flagged in the report.
{.callout-info}

### Default Configuration

| # | Question | Assessment guidance |
|---|---|---|
| 5.2.1 | What is the default algorithm configuration for each feature area in a fresh installation? | The assessor should perform or observe a fresh installation. Record: product version, installation method (binary installer / container image / cloud deployment), environment (OS version, cloud provider, hardware type), and the configuration captured (exported configuration file, screenshot of settings UI, or API response for the default configuration endpoint — record which method was used). Verify that quantum-safe algorithms appear as the default without any manual modification. A finding based on documentation review only — without a fresh installation test — must be flagged as "not independently reproduced". |
| 5.2.2 | How does an operator explicitly enable classical (non-quantum-safe) algorithms? Show the exact configuration step. | Record the exact configuration step required (configuration key, flag, UI setting, API call). Test it: apply the enablement step, verify it works, and verify the product emits a warning or audit log entry indicating a downgrade. Record: test environment, product version, steps performed, and outcome. **A default that silently falls back to classical when a quantum-safe peer is unavailable — without an explicit operator action and an audit log entry — is a disqualifying finding for Level 5.** |
| 5.2.3 | Is the default quantum-safe configuration consistent across all supported deployment modes — cloud, on-premises, container, embedded? | Record each supported deployment mode and the evidence type for each: (a) assessor-tested — record installation method, environment, and result; (b) vendor-provided configuration export — record document title, version, and date; (c) documentation only — flag as "not independently reproduced". Inconsistency between modes is a finding — record which mode fails and note that the effective maturity level for that mode is lower. |

### Performance

| # | Question | Assessment guidance |
|---|---|---|
| 5.3.1 | Has the vendor benchmarked the product in its default quantum-safe configuration? Request the benchmark report. | Record all of the following methodology fields from the report: hardware (CPU model, core count, RAM, whether results are from cloud instances or bare metal), operating system and version, runtime/JVM version if applicable, test tool name and version (e.g., wrk 4.x, JMeter 5.x, vendor-specific harness — record tool and version), algorithm and parameter set tested, load profile (requests/second or key operations/second), test duration, warm-up period, and classical comparison baseline (algorithm and parameter set). A benchmark that does not specify hardware and test tool cannot be reproduced by an independent party — flag it as non-reproducible. |
| 5.3.2 | Do quantum-safe configurations meet performance requirements for the product's stated use cases? | Record the vendor's SLA or performance specification (document title, version, URL) and compare it against the benchmark results field by field. *Note the hardware on which the benchmarks were run versus the customer's expected deployment hardware — a result on premium hardware may not translate to the customer's environment.* Performance shortfalls relative to the SLA must be documented and risk-assessed. |
| 5.3.3 | Have algorithm implementations been optimised for the product's target hardware? | Ask which optimisation paths are enabled: AVX2, AVX-512, ARMv8 crypto extensions, hardware accelerator offload. Record each optimisation with: whether it is enabled by default (yes/no), the documentation URL confirming it, and whether the assessor verified it is active (e.g., by checking CPU feature flag usage in a running process, reviewing build flags in the binary, or consulting the documentation). An unoptimised software reference implementation in a performance-sensitive production deployment is a risk signal — record the optimisation status explicitly. |

### Standards Alignment

| # | Question | Assessment guidance |
|---|---|---|
| 5.4.1 | Which NIST-approved PQC standards are implemented as the primary algorithm suite? Provide the specific FIPS publication reference and date. | Verify each claimed algorithm name against the FIPS publication. Record the exact FIPS designation with publication URL: NIST FIPS 203 (ML-KEM, August 2024, https://csrc.nist.gov/publications/detail/fips/203/final), FIPS 204 (ML-DSA, https://csrc.nist.gov/publications/detail/fips/204/final), FIPS 205 (SLH-DSA, https://csrc.nist.gov/publications/detail/fips/205/final). Implementations based on pre-standardisation round 3 submissions that have not been updated to the final FIPS name are a finding — record whether the product uses FIPS names or draft names. |
| 5.4.2 | Does the CBOM confirm that algorithm usage matches the declared FIPS standards? Cross-reference the CBOM against the declared algorithms. | Run a CBOM analysis. Record: tool name and version, date run, and for each algorithm entry checked — the name found in the CBOM and whether it matches the FIPS name. A CBOM entry showing "Kyber-768" instead of "ML-KEM-768", or "Dilithium-3" instead of "ML-DSA-65", indicates the implementation was not updated to the final standard — this is a disqualifying finding for Level 5. Sample at least three entries per algorithm type and record the results individually. |

### Independent Verification

| # | Question | Assessment guidance |
|---|---|---|
| 5.5.1 | Has the cryptographic module been validated under FIPS 140-3 or an equivalent national scheme? Provide the certificate number or CMVP listing URL. | Verify independently: search the NIST CMVP database (https://csrc.nist.gov/projects/cryptographic-module-validation-program) by product or library name. Record: certificate number, module name, vendor name, module version, validation date, approved algorithm list, and the certificate page URL. Verify that (a) the validated module version matches the product version under assessment, and (b) the PQC algorithms (ML-KEM, ML-DSA, SLH-DSA) explicitly appear in the approved algorithm list. A FIPS 140-2 validation or a validation predating FIPS 203/204/205 does not cover quantum-safe algorithms — record this distinction explicitly. |
| 5.5.2 | Has a Common Criteria evaluation been conducted? If so, provide the certificate reference and EAL level. | Verify via the Common Criteria portal (https://www.commoncriteriaportal.org). Record: certificate reference number, product name and version evaluated, EAL level, evaluation laboratory, certification date, and URL. Check the Security Target document to determine whether the cryptographic implementation was within the evaluation scope — an EAL evaluation that did not include cryptographic algorithm testing is noted as not covering this criterion. |
| 5.5.3 | Which cryptographic library implements the quantum-safe algorithms? | Common libraries include OpenSSL (with or without oqs-provider), wolfSSL, Bouncy Castle, AWS-LC, Microsoft CNG / BCryptPrimitives, NSS, mbedTLS, LibreSSL, Botan, and Crypto++. Record: **(a)** library name and exact version string as reported by the vendor; **(b)** for open-source libraries: the repository URL and the specific commit hash or release tag; **(c)** verify independently — from the library's own official release notes or PQC documentation page — that the identified version supports the claimed quantum-safe algorithms; **(d)** check for NIST CAVP validation for the library (https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program) — record the validation URL and certificate scope if available; **(e)** for proprietary implementations: whether a published security analysis exists, the analysis firm name, and the analysis URL or reference. |
| 5.5.4 | Are the results of any third-party cryptographic audit of the quantum-safe implementation available? | Record: audit firm name, report title, date, and URL if publicly available (or document reference if under NDA). Review the report's methodology section and record explicitly: **(a)** scope — which components and which algorithms were audited; **(b)** assessment method — CBOM-based analysis, static code review, dynamic analysis, functional testing, or a combination; **(c)** tools used — e.g., CodeQL, Semgrep, manual code review, NIST KAT test vectors, specific version of each; **(d)** whether the PQC algorithms and parameter sets implemented in the assessed product were within the audit scope. An audit whose scope excluded the quantum-safe implementation does not satisfy this criterion — record the gap. |

## Evidence Checklist

The items below are a level-specific summary of the artefacts a vendor should be able to produce. They can serve as a concise request list for an assessor, or as a self-assessment reference for a vendor preparing evidence before a formal assessment. The detailed requirements and acceptance criteria for each item are in the assessment questions above. All artefacts from [Level 1](/wg/pqc/pqcmm/levels/1-initial/#evidence-checklist), [Level 2](/wg/pqc/pqcmm/levels/2-basic/#evidence-checklist), [Level 3](/wg/pqc/pqcmm/levels/3-advanced/#evidence-checklist), and [Level 4](/wg/pqc/pqcmm/levels/4-managed/#evidence-checklist) remain required.

- Product documentation confirming quantum-safe defaults with change instructions for legacy opt-in.
- Published or shareable performance benchmark results for the quantum-safe configuration.
- FIPS 140-3 (or equivalent) certificate or validation listing for the cryptographic module.
- References to the standard specifications implemented (with version/edition).
- Third-party audit reports or publicly available security analyses for cryptographic components.

## Suggested Procurement Actions

- Verify FIPS 140-3 validation certificates directly with the vendor and via the CMVP database.
- Review benchmark results against your organisation's SLA requirements.
- Confirm that the "quantum-safe default" covers all use cases relevant to your deployment — some products default to quantum-safe for new sessions but retain classical for legacy connections.
- Use Level 5 as the benchmark for all new procurement in critical trust infrastructure roles.

