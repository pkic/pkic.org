---
title: SSL 2.0 and DROWN
authors: [Bruce Morton]
date: 2016-04-04T18:41:33+00:00
dsq_thread_id:
  - 4719900263


---
A team of researchers has announced a vulnerability with [SSL 2.0][1] called **D**ecrypting **R**SA with **O**bsolete and **W**eakened e**N**cryption; otherwise known as [DROWN][2].

SSL 2.0 is a version of the [SSL/TLS security protocols][3]. It was released in February 1995, but due to [security flaws][4] was superseded by SSL 3.0 in 1996.

DROWN is a cross-protocol attack where the bugs in SSL 2.0 can be used to attack the security of connections that use TLS. The vulnerability applies to servers:

  * Configured to use SSL 2.0
  * Some versions of OpenSSL with SSL 2.0 disabled even with all SSL 2.0 cipher suites removed
  * Servers using the same key as another server meeting one of the previous two criteria

Although no modern browsers support any version of SSL, a DROWN attack would not require the browser client to make an SSL 2.0 connection. DROWN is also not a protocol downgrade attack. As such, mitigations that commonly work against those types of attack are ineffective.

The DROWN vulnerability is based on the [Bleichenbacher attack][5] from 1998. DROWN also takes advantage of SSL 2.0’s weak anti-Bleichenbacher countermeasure and weak export ciphers. The attack can be performed in about 8 hours for a cost of about $440 on Amazon EC2.

DROWN exploits the conflict between minimum privileges and backwards compatibility. Although SSL 2.0 was never secure and should only have been deployed for about a year, it was kept in products as a fallback protocol to support SSL 2.0 based clients

The IETF provided little guidance for removing support for obsolete protocols and algorithms from Web component implementations until RFC6176 in 2011.  The cost and delay associated with the shift from SHA-1 to SHA-2 gives us another example of how poorly some legacy products handle protocol and algorithm agility.

For testing, the DROWN researchers provide [a test][6] that will check if the corresponding server appears to be vulnerable. Our [SSL Server Test][7] may also provide information, but that test is still experimental.

SSL/TLS best practices demand that server administrators consider the following steps to mitigate DROWN:

  * Do not support SSL 2.0; you should also not support SSL 3.0.
  * [OpenSSL users][8] should upgrade 1.0.2 to version 1.0.2g and 1.0.1 to version 1.0.1s.
  * Do not use the same keys on different servers; this applies even if the certificates are different.

For more information I would suggest reading [Matthew Green’s blog][9] and reviewing the [DROWN Q&A][10].

 [1]: https://en.wikipedia.org/wiki/Transport_Layer_Security#SSL_1.0.2C_2.0_and_3.0
 [2]: https://drownattack.com/
 [3]: https://en.wikipedia.org/wiki/Transport_Layer_Security
 [4]: https://en.wikipedia.org/wiki/Transport_Layer_Security#SSL_2.0
 [5]: http://archiv.infsec.ethz.ch/education/fs08/secsem/Bleichenbacher98.pdf
 [6]: https://test.drownattack.com/
 [7]: https://casecurity.ssllabs.com/
 [8]: https://www.openssl.org/news/secadv/20160301.txt
 [9]: http://blog.cryptographyengineering.com/2016/03/attack-of-week-drown.html
 [10]: https://drownattack.com/#question-answer