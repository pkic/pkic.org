---
title: Preparing for Quantum Computing
summary: Quantum computing is advancing, and while experts are not sure when there will be a quantum computer powerful enough to break the RSA and ECC cryptographic algorithms that are currently in use, many are operating under the assumption that this can happen within a 10-15 year timeframe.
authors: [Diana Gruhn]
date: 2020-04-21T17:09:27+00:00
tags:
- Quantum
- IETF
- Crypto Agility
- RSA
- ECC

---
Quantum computing is advancing, and while experts are not sure when there will be a quantum computer powerful enough to break the RSA and ECC cryptographic algorithms that are currently in use, many are operating under the assumption that this can happen within a 10-15 year timeframe. This is a general timeline because there is no way to know when this will occur – it could happen sooner or it could happen later.

## The Road to Crypto Agility

The IETF is working on proposals to create new X.509 certificate formats with multiple keys (called hybrid or composite certificates) that would help with cryptographic agility by supporting both classical (RSA/ECC) and PQ algorithms. We recommend that organizations keep an eye on this issue since migration from RSA to a new algorithm(s) could take several years.  Here are some things you can do to prepare for a PQ world:

- One of the best places to start is to perform a cryptographic inventory, understanding what algorithms are in use in which systems, and ensure that no algorithms are hard coded into your systems.
- Ask your vendors what they are doing to prepare for PQ algorithms and how they are planning to ensure that their systems are more crypto agile (better able to replace cryptographic algorithms).
- While we don’t know what algorithms will be selected yet, hybrid or composite certificates may be introduced to help ease the migration, but they have not received the required IETF approval.

While organizations might want to take a look at and even build prototypes with some of the PQ algorithms currently being assessed by NIST for standardization, you should **not** be rolling these into production. New algorithms are still being scrutinized and the details of algorithms may change. There may be as many as 4-6 different algorithms standardized for different use cases: IoT traffic, web traffic, etc. NIST has suggested that they will wrap up evaluation of PQ algorithms around 2022 when they will announce which ones are going to be standardized.

## KEY TAKEAWAYS

1. Don’t panic! But do watch PQ closely for planning purposes.
2. While quantum computing is advancing, we don’t know for certain when it will advance enough to break RSA and ECC.
3. Experts are studying potential new algorithms and the impact of those algorithms on existing protocols.
4. Do a cryptographic inventory.
5. Ask vendors about their plans for PQ and cryptographic agility.
