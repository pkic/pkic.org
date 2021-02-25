---
authors:
- Bruce Morton
- Clayton Smith
date: "2014-01-30T18:30:55+00:00"
dsq_thread_id:
- 2193146291
keywords:
- ssl
- attack
- md5
tags:
- SSL/TLS
- Attack
- SHA2
title: Why We Need to Move to SHA-2


---
Previously, we advised that the [SSL industry must move to the SHA-2 hashing algorithm][1] for certificate signatures. We thought it would be helpful to provide the reasoning behind the position.

In the context of SSL, the purpose of a hashing algorithm is to reduce a message (e.g., a certificate) to a reasonable size for use with a digital signature algorithm. The hash value, or message digest, is then signed to allow an end-user to validate the certificate and ensure it was issued by a trusted certification authority (CA). In the past, we used [MD5][2] for hashing; we are now primarily using [SHA-1][3] while beginning the transition to [SHA-2][4], and have [SHA-3][5] available for the future.

Hash attacks are described as follows, in increasing order of difficulty for an attacker:

  * [**Collision**][6] – A collision attack occurs when it is possible to find two different messages that hash to the same value. A collision attack against a CA happens at the time of certificate issuance. In a past [attack against MD5][7], the attacker was able to produce a pair of colliding messages, one of which represented the contents of a benign end-entity certificate, and the other of which formed the contents of a malicious CA certificate. Once the end-entity certificate was signed by the CA, the attacker reused the digital signature to produce a fraudulent CA certificate. The attacker then used their CA certificate to issue fraudulent end-entity certificates for any domain. Collision attacks can be mitigated by putting entropy into the certificate, which makes it difficult for the attacker to guess the exact content of the certificate that will be signed by the CA. Entropy is typically found in the certificate serial number or in the validity periods. SHA-1 is known to have weaknesses in collision resistance.
  * [**Second-preimage**][8] – In a second-preimage attack, a second message can be found that hashes to the same value as a given message. This allows the attacker to create fraudulent certificates at any time, not just at the time of certificate issuance. SHA-1 is currently resistant to second-preimage attacks.
  * [**Preimage**][8] – A preimage attack is against the one-way property of a hash function. In a preimage attack, a message can be determined that hashes to a given value. This could allow a password attack, where the attacker can determine a password based on the hash of the password found in a database. SHA-1 is currently resistant to preimage attacks.

Attacks against hash functions are measured against the length of time required to perform a brute-force attack, in which messages are selected at random and hashed until a collision or preimage is found. Thanks to the [birthday paradox][9], the time required to find a collision by brute force is approximately _2ⁿᐟ²_, where _n_ is the bit length of the hash. To find a preimage or second-preimage by brute force, approximately _2n_ messages must be hashed. Thus, a hash function is weakened if a collision can be found in less time than that needed to compute _2ⁿᐟ²_ hashes, or if a preimage or second-preimage can be found in less time than would be needed to compute _2n_ hashes. For common hashes the bit length is: MD5 (128 bits), SHA-1 (160 bits) and SHA-2 (224, 256, 384, or 512 bits).

The time required to perform a brute-force attack keeps getting shorter due to increases in available computing power (see [Moore’s Law][10]). As such, increases in hash function lengths are necessary to maintain an acceptable margin of security. In the past, an attack threshold of _2⁶⁴_ operations was considered acceptable for some uses, but [NIST recommendations][11] now set the bar at _2⁸⁰_, and this will soon move up to _2¹¹²_.

Using the formula _2ⁿᐟ²_, we can see that a brute-force attack against SHA-1 would require _2⁸⁰_ computations. Unfortunately, security researchers have discovered an attack strategy that requires only _2⁶¹_ computations. This would make the time required to perform an attack below current standards. In fact, [Bruce Schneier has estimated][12] that the cost of a performing SHA-1 collision attack will be within the range of organized crime by 2018 and for a university project by 2021.

The bottom line is SHA-1’s collision resistance is weak and the cost of an attack is dropping; as such, SHA-1 must be replaced with SHA-2.

Certificate owners are encouraged to test and deploy certificates signed with SHA-2. If your application does not support SHA-2, please inform your product vendor and your CA.

 [1]: https://casecurity.org/2013/12/16/sha-1-deprecation-on-to-sha-2/
 [2]: https://en.wikipedia.org/wiki/Md5
 [3]: https://en.wikipedia.org/wiki/SHA-1
 [4]: https://en.wikipedia.org/wiki/SHA-2
 [5]: https://en.wikipedia.org/wiki/Sha-3
 [6]: https://en.wikipedia.org/wiki/Collision_attack
 [7]: http://www.win.tue.nl/hashclash/rogue-ca/
 [8]: https://en.wikipedia.org/wiki/Preimage_attack
 [9]: https://en.wikipedia.org/wiki/Birthday_problem
 [10]: https://en.wikipedia.org/wiki/Moore's_law
 [11]: http://csrc.nist.gov/publications/nistpubs/800-131A/sp800-131A.pdf
 [12]: https://www.schneier.com/blog/archives/2012/10/when_will_we_se.html