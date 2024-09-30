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


## Security Threats
The scientific community agrees that a feasible quantum computer is far from reach but may be on the distant horizon. An attacker with access to such a computer poses a threat to the secrecy and integrity of communication transmitted online.

It is considered relatively safe to assume that quantum computers are mainly a [concern for asymmetric cryptography](https://ibm.docs/en/integration-bus/10.0?topic=overview-public-key-cryptography), so our current implementation of authenticated cipher (AEAD), most notably the standard AEC-GCM, needs not worry.

However, one may ask what part of a TLS connection is at risk and at what point in time. In order to assess the security of the asymmetric primitives in a TLS connection, we need to distinguish between KEM and signatures. Simply put, KEM need to be replaced more urgently with a quantum-secure alternative because of the [_harvest now; decrypt later_](https://en.wikipedia.org/wiki/Harvest_now,_decrypt_later) paradigm; an attacker may record your traffic today, store it on her computer, and with the advent of a quantum computer, use it to break the KEM. That would give her access to the shared key, and she would be able to decrypt the data followed. Given that some information transmitted online needs to be kept secret for decades to come (e.g., medical records), it is a good idea to mitigate that attack _now_.

There is no similar attack that can be deployed on authentication or asymmetric signature schemes. An attacker with access to signatures cannot use quantum computers in the future to affect the traffic. This is due to the nature of their usage, which is aimed at preventing man-in-the-middle and impersonation attacks. These attacks assume the attacker acts online, namely while the TLS connection takes place.


## Efficiency Concerns
Quantum-secure cryptographic primitives offer a higher grade of security by accommodating the threat of an attacker with access to a quantum computer. However, these enhanced security claims come at a painful performance cost which currently seems eminent.

The efficiency of a cryptographic primitive can generally be measured along two almost uncorrelated vectors: time complexity (CPU cycles) and space complexity (bytes on the wire). Both metrics measure the extra time and space needed by TLS before the first byte of actual secured content is sent. A negative effect on either of them may be painful on a global scale, especially for small or poorly connected devices.

While some algorithms offer similar or even better time complexity compared to classic (quantum-insecure) algorithms, virtually all quantum-secure algorithms with reasonable security claims incur significant overhead when it comes to message size.

Similarly to the previous section, we find that efficiency is handled differently when we consider KEMs and signature schemes. While quantum-secure key exchange mechanisms make a small difference compared to classical algorithms, transitioning to quantum-secure asymmetric signature schemes is costlier. The negative impact is double headed: not only do the quantum-secure primitives require many more bytes than their classic alternatives, but a standard TLS handshake generally contains six signatures and two public keys. This means that each additional overhead gets a big multiplier when sizing the whole handshake.


## How Expensive it Can Get
The numbers in this section follow a survey published recently by [Cloudflare](https://blog.cloudflare.com/it-it/pq-2024), and account for the finalists of the NIST process.

Quantum-secure KEMs offer minimal overhead compared to their classic counterparts. For example, TLS's golden standard for key exchange X25519 is about three times slower on a CPU than the fastest and smallest NIST-approved alternative - ML-KEM-512. However, it requires a total of 64 bytes on the wire (32 from each party), whereas ML-KEM-512, requires a total of 1568 bytes on the wire.

Making our asymmetric signatures quantum-secure is a much more demanding shift. Let us consider ML-DSA, as it is the only NIST-approved asymmetric signature scheme with quantum-security and reasonable sizes (SLH-DSA signatures are more than 100x heavier in bandwidth than the current classic signatures). Compared to the commonly used classic asymmetric signature scheme Ed25519, while time complexity is only a bit worse (less than a 5x factor for signing, and in fact faster verification), bandwidth complexity is a lot worse. Instead of Ed25519's 32 bytes for public key and 64 bytes for signature, ML-DSA offers for the same level of security 1312 bytes for public key and 2420 bytes for signature.

Accessing a website for the first time requires at least one fresh TLS handshake which generally includes six signatures and two public keys. That means that instead of sending 448 bytes for Ed25519, for ML-DSA we would have to send 17,144 bytes! That is almost 17 kB per handshake, which may sound small compared to graphics served on webpages, but can be destructive for time-critical API calls or in scenarios that include weak devices or poor connection.

Transmitting more bytes on the wire for asymmetric cryptography than for actual content may sound comically ridiculous, but it can actually have severe consequences. Not only can sending large packets on the wire be extremely slow, but due to TCP's [_congestion window_](https://en.wikipedia.org/wiki/TCP_congestion_control#Congestion_window) , which bounds the sizes of a TCP segment, it may be required to send these TLS messages over several packets, severely affecting latency and time to the first content byte. It also increases the chances that a weak connection will be dropped.

Moreover, the firmware of some network devices such as old routers or terminals, were designed with a general idea of what a TLS connection looks like. TLS messages this long may be dropped by the firmware of these devices, rendering them useless. This means that trying to use the current alternatives as drop-in replacements to the contemporary signature schemes may require a pricey recall of many network devices.

Google recently [claimed](https://www.chromium.org/Home/chromium-security/post-quantum-pki-design) that it (somewhat softly) bounds the bandwidth overhead it can accommodate for containing a quantum attacker by 7 kB. No NIST approved signature scheme can currently get anywhere near those numbers for reasonable time complexity and security margins.


## Cryptographic Strength
Quantum-secure cryptography is a relatively new branch of cryptography. Shor's algorithm was developed in 1994, and most primitives are based on mathematical problems whose study started around that time. As such, not much is known about their strength and possible pitfalls. In cryptography, uncertainty usually means danger, and this may be the case.

Well known examples of this claim are two contestants from the NIST post-quantum competition. These are a multivariate-based scheme named [Rainbow](https://eprint.iacr/2022/214), and an isogeny-based scheme named [SIKE](https://eprint.iacr/2022/975). Despite advancing several rounds in the NIST competition and being close to advancing to the final round, they were both broken completely, and even classically so-a classic attacker with a commercial laptop can break the schemes in a relatively short time.

It is not clear what prevents other schemes, approved by NIST or not, from facing the same fate. It is noted that except for the hash-based signature scheme SLH-DSA, which is a poor fit for TLS, the other schemes approved by NIST are based on lattices. Given that the initial list of contestants contained primitives based on various fields, this may also raise some questions about their security or our understanding thereof.


## The (Near) Future
It is in the public consensus that the state-of-the-art quantum-secure key exchange mechanism as approved by NIST, namely ML-KEM, is a solid alternative and generally ready for widespread deployment, at least in a hybrid scheme, as it has also been tested in several tests conducted by [Google  and Cloudflare](https://medium.com/hwupathum/x25519kyber768-post-quantum-hybrid-algorithm-supported-by-google-chrome).

Contrary to the KEM world, no consensus has yet been reached when it comes to tackling the challenge of making our asymmetric signatures quantum-secure. NIST's finalists for signatures simply cannot be used as drop-in replacements for current classical algorithms due to performance issues.

Acknowledging the problems with the current quantum-secure signature schemes, NIST announced the creation of the signatures "on-ramp" [competition](https://csrc.nist.gov/projects/pqc-dig-sig/standardization) in an effort to find better alternatives, in terms of security but mainly in terms of time and bandwidth efficiency.

Seeing that KEM can be shipped and deployed as a drop-in replacement almost instantly with minimal costs to performance, and that KEM faces a very real threat in the present due to the harvest-now-decrypt-later paradigm, and that signature schemes are both a lot more expensive to deploy and less risky in the current era of the pre-quantum-relevant computer, it seems urgent to start a process of distributing a quantum-secure key exchange mechanism, if only to flex the deployment muscle and the idea of containing a quantum threat. For signatures whose threat is much more distant, it is best to give more time to study before standardizing a decent solution and deploying it.

## Conclusion
Ongoing efforts to deploy PQ/hybrid KEMs as drop-in replacements for current mechanisms are well-tested and crucial for protecting information and identity in the near future. On the other hand, PQ signatures remain an unsolved problem, at least in terms of being drop-in replacements for ECC/RSA. Given that WebPKI is integrated into the core of modern-day communication and the threat is much more distant, it is best to be careful and measured with deployment of new algorithms, as tempting and shiny as they might seem.

## Feedback
Did you like the article? Please send your feedback at “dzacharo at yahoo.com”.

