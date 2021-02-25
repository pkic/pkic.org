---
authors:
- Bruce Morton
date: "2014-11-21T15:15:32+00:00"
dsq_thread_id:
- 3238353717
keywords:
- vulnerabilities
- ssl 3.0
- mozilla
- tls 1.1
- tls 1.0
- ssl
- google
- attack
- openssl
- encryption
- tls
- tls 1.3
- ietf
tags:
- Vulnerability
- SSL 3.0
- Mozilla
- TLS 1.1
- TLS 1.0
- SSL/TLS
- Google
- Attack
- OpenSSL
- Encryption
- TLS 1.3
- IETF
title: A Follow-up on POODLE and SSL 3.0


---
In October 2014, [Google announced POODLE][1], an SSL 3.0 protocol attack.

To bring you up to speed, the [SSL/TLS protocol][2] is the most important and popular security protocol on the Internet. The Secure Sockets Layer (SSL) protocol was developed by Netscape. They quickly moved from SSL 1.0 to 2.0 and finalized with SSL 3.0 in 1996.

This protocol was then picked up by the IETF, who released it under the name of Transport Layer Security (TLS). The IETF released TLS 1.0, 1.1 and 1.2. They are currently working on TLS 1.3.

When a server and a browser are trying to connect, they negotiate the SSL/TLS protocol version. They settle on the highest level to support the highest level of security. The browsers and servers are very concerned about compatibility, so, if required, they can back down to a low level of SSL/TLS protocol.

To implement POODLE, the attacker must get the browser and server to settle on SSL 3.0. Although both the browser and server may be able to negotiate a higher level, the attacker can induce some errors that will generally be sorted out by decreasing the protocol to SSL 3.0.

Once the handshake has been downgraded to SSL 3.0, the attacker can use POODLE. We won’t go into much detail on POODLE (Padding Oracle On Downgraded Legacy Encryption), but it will allow items such as “secure” HTTP cookies or HTTP Authorization header contents to be stolen from downgraded communications.

The good news is that the actions to mitigate POODLE will kill SSL 3.0. This is not a bad thing. SSL 3.0 is more than 16 years old. Basically, most systems that support SSL 3.0 also support TLS 1.0 and many support TLS 1.1 and1.2 as well.

To mitigate POODLE, most operating systems and browser vendors (e.g., Microsoft, Google and Mozilla) are removing support for SSL 3.0. From the server side, many administrators are also removing support for SSL 3.0.

If SSL 3.0 must be supported, then the administrator may be able to implement fallback protection called [TLS\_FALLBACK\_SCSV][3]. Fallback protection has been [included in OpenSSL][4]. Server administrators should check to see if fallback protection is supported in their servers.

So, how have we done with eliminating the use of SSL 3.0? The image below, taken from [SSL Pulse][5], indicates SSL 3.0 has dropped from 98 percent to 61 percent in one month. Please note the information is based on the top 200,000 sites. We expect less dramatic drops over the next few months and that both SSL 2.0 and SSL 3.0 will be minimal by the end of 2015.

{{< figure src="/uploads/2014/11/follow-up-poodle-ssl3.png" >}} 

Moving forward, system designers should ensure their systems and applications support TLS 1.0, 1.1 and 1.2. Please note that TLS 1.0 was released in January 1999 — it is almost 16 years old. A new attack could also kill TLS 1.0, so designers and administrators will want their systems to have the ability to upgrade.

More information on how POODLE works can be found in the [Security Advisory prepared by Google][1]. More detail and supporting information can be found at the Common Vulnerabilities and Exposures [CVE-2014-3566][6].

 [1]: https://www.openssl.org/~bodo/ssl-poodle.pdf
 [2]: https://en.wikipedia.org/wiki/Transport_Layer_Security
 [3]: https://tools.ietf.org/html/draft-ietf-tls-downgrade-scsv-00
 [4]: https://www.openssl.org/news/secadv_20141015.txt
 [5]: https://www.trustworthyinternet.org/ssl-pulse/
 [6]: https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2014-3566