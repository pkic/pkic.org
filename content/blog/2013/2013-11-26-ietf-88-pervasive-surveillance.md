---
authors:
- Bruce Morton
date: "2013-11-26T19:00:04+00:00"
dsq_thread_id:
- 2001652975
keywords:
- pki
- crl
- ssl
- web pki
- vulnerability
- attack
- forward secrecy
- encryption
- ietf
- revocation
- hsts
tags:
- PKI
- CRL
- SSL/TLS
- Web PKI
- Vulnerability
- Attack
- Forward Secrecy
- Encryption
- IETF
- Revocation
- HSTS
title: IETF 88 – Pervasive Surveillance


---
### Internet Surveillance

The big news at [IETF 88 in Vancouver][1] was the technical plenary on [Hardening the Internet][2] which discussed the issue of pervasive surveillance. Pervasive surveillance is a mass surveillance of an entire or a substantial fraction of a population. The surveillance is usually carried out by government, is not targeted and its occurrence may not be overt. It was noted that pervasive surveillance, of the kind revealed in the Snowden-sourced documents, constitutes a misguided and damaging attack on civic society in general and the Internet in particular.

The session was headlined by security guru [Bruce Schneier][3]. In Schneier’s presentation he stated, “The goal is to make eavesdropping expensive. That’s the way to think about this, is to force the NSA to abandon wholesale collection in favor of targeted collection of information.”

Pervasive surveillance is an attack on the Internet and must be treated as an attack. This is not an attack of the cryptography as it was pointed out that the math is good and encryption works if properly implemented. However, there are far too many end-point security issues impacting the implementation of encryption and end-to-end security.

Security Area Director Stephen Farrell stated, “While there are challenges isolating the specific areas of attack that IETF protocols can mitigate, all of the working groups that considered the topic have started planning to address the threat using IETF tools that can mitigate aspects of the problem.”

In the end, the Internet technical community continued reviewing what they can do to take action, such as:

  * Pervasive surveillance is too cheap. We need to make eavesdropping expensive in order to shift surveillance from pervasive to targeted
  * Make eavesdropping open and shift surveillance from covert to overt
  * Provide opportunistic or application layer encryption
  * Provide assurance no matter what the software does
  * Enable perfect forward secrecy
  * Enable Always-On-SSL or HSTS

### Web PKI Working Group

There was also a meeting of the [Web PKI working group][4]. The goal of this group is to document how the Web PKI was deployed. The reason this is interesting is the Web PKI was not deployed 100 percent in accordance with IETF standards, which may leave some management and security issues.

The Web PKI working group will document the following:

  * Trust model
  * Certificate/CRL fields and extensions
  * Certificate revocation
  * TLS stack implementation

Once the current deployment is documented, then there likely will be projects to help standardize the Web PKI to continue to bring security to the Internet.

### References

  * <http://www.ietf.org/blog/2013/11/we-will-strengthen-the-internet/>
  * <http://www.ietf.org/proceedings/88/wpkops.html>
  * <http://www.youtube.com/watch?v=oV71hhEpQ20>
  * <https://www.tbray.org/ongoing/When/201x/2013/11/10/IETF-88>
  * <http://www.darkreading.com/vulnerability/schneier-make-wide-scale-surveillance-to/240163668>

 [1]: http://www.ietf.org/meeting/88/
 [2]: https://www.youtube.com/watch?v=oV71hhEpQ20
 [3]: https://www.schneier.com/
 [4]: http://www.ietf.org/proceedings/88/wpkops.html