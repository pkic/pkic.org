---
authors:
- Kirk Hall
date: "2015-05-26T16:00:54+00:00"
dsq_thread_id:
- 3794748637
keywords:
- https
- vulnerability
- google
- attack
- encryption
- vulnerabilities
- mitm
- apple
tags:
- SSL/TLS
- Vulnerability
- Google
- Attack
- Encryption
- MITM
- Apple
title: Practical Steps to Counter the Logjam Attack


---
Another flaw has been found in the basic encryption algorithms that secure the Internet. This flaw, named the Logjam attack by its discoverers (researchers from various universities and companies), allows an attacker that can carry out man-in-the-middle (MitM) attacks to weaken the encryption used in secure connections (such as HTTPS, SSH, and VPNs). In theory, this means that an attacker (with sufficient resources) can break the encryption and read the “secure” traffic.

In some ways, this attack is a subset of the recent FREAK attack. Both attacks were made possible by support for “export-grade” encryption standards. Until the 1990s, cryptography was considered a “munition” in the United States and limits were placed on the strength of cryptography that products “exported” for use outside of the US. Unfortunately, what was “acceptable” cryptography then can now be cracked with sufficient computation resources.

A technical explanation: The vulnerability lies in how the Diffie-Hellman key exchange is carried out. Logjam can be used to lower the encryption strength of the session.  The MitM changes the client’s message to the server and asks for a Diffie-Hellman prime that is less than what the client actually asked for.  The server accommodates the falsified request and sends the 512-bit, 768-bit, 1024-bit, or whatever length prime was requested.  Prevalent are ones that use 512-bit prime numbers (as used in “export-grade” encryption). 

Research carried out by Logjam researchers proved that vulnerabilities are present in systems that use 768- and even 1024-bit primes. Nation-states may have the resources needed to compromise key exchange using common 1024-bit primes, which can allow an attacker to decrypt secure traffic that has been passively collected.  Thus, it is recommended that at least 2048-bit primes be specified for Diffie-Hellman key exchange.

## Who Is at Risk?

Theoretically, any protocol that uses the Diffie-Hellman key exchange is at risk from this attack. However, note that this attack requires two factors on the part of the attacker: the ability to intercept traffic between the secure server and the client, as well as computation resources commensurate with the encryption strength.

The researchers estimate that up to 8.4% of all sites in the top one million domains are vulnerable. Similar percentages of POP3S and IMAPS (secure email) servers are at risk.

## What Should I Do Now?

For end users, there’s really only one thing to do: update your browsers. All the major browser vendors (Google, Mozilla, Microsoft, and Apple) are preparing updates for their various products, and should release an update soon. You can also check if your browser is vulnerable by visiting this site: [https://weakdh.org/](https://weakdh.org/).

For software developers, the fix is also relatively simple. Check that any encryption libraries that are used or bundled with your application are all up to date. In addition, the use of larger prime numbers for key exchange can be specified as well.

The main task falls on IT administrators with servers that use any of the at-risk services and protocols. In these cases, the following needs to be performed:

  * Disable support for all export cipher suites, to ensure they cannot be used; and
  * Increase the number of bits used by the prime numbers in the Diffie-Hellman key exchange to 2048 bits; this ensures that exceptional computational powers would be needed to break any encryption based on this process.