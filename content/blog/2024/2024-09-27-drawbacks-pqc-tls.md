---
title: On the Drawbacks of Post-Quantum Cryptography in TLS
summary: Ongoing efforts to deploy PQ/hybrid KEMs as drop-in replacements for current mechanisms are well-tested and crucial for protecting information and identity in the near future. On the other hand, PQ signatures remain an unsolved problem - at least in terms of being drop-in replacements for ECC/RSA.
authors: 
- Dimitris Zacharopoulos
date: 2024-09-27T12:00:00+00:00
categories:
keyword: [cryptography, post-quantum, pqc, tls, quantum-safe]
tags: [Post-Quantum Cryptography, PQC, TLS]

---

## Introduction

In early [August 2024](https://nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards), NIST concluded its eight-year long competition and finalized in FIPS 203 through 205 three quantum-secure public-key cryptographic primitives: a lattice based key exchange mechanism branded as **ML-KEM** (previously CRYSTALS-Kyber), a lattice based asymmetric signature scheme branded as **ML-DSA** (CRYSTALS-Dilithium) and a hash-based asymmetric scheme branded as **SLH-DSA** (SPHINCS+). Two weeks later, NIST completed the assignment of Object Identifiers (OIDs) to all the new algorithms, taking another step towards integrating them in real world protocols.

While discussions are still held on the exact specifications and implementation details, these seem to be the leading (if not default) picks for making our telecommunication quantum-secure, namely, secure against an attacker with access to a large quantum computer.

We distinguish between _key exchange mechanisms_ (KEM) and asymmetric signature schemes. While the community is somewhat satisfied with NIST's pick for KEM, and deploying it comes at a modest cost, things are more complicated when it comes to signatures. The threats the primitives face are also inherently different.

In this article, we survey these solutions and the implications of their wide deployment in the Internet. We focus on their uses in [Transport Layer Security](https://cloudflare.com/learning/ssl/transport-layer-security-tls) (TLS) handshakes, and refrain from diving into the cryptographic weeds of the schemes. As a result, no prior knowledge in advanced cryptography is needed, but the reader is expected to be familiar with TLS and the general idea of how the Internet works and what can break it.