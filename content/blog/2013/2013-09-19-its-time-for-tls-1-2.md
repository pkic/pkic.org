---
authors:
- Wayne Thayer
date: "2013-09-19T15:00:40+00:00"
dsq_thread_id:
- 1937106864
keywords:
- attack
- rc4
- ocsp
- tls
- tls 1.2
- vulnerabilities
- ssl 3.0
- tls 1.1
- tls 1.0
- firefox
- sha2
- chrome
- ssl
- https
- vulnerability
- beast
tags:
- Attack
- RC4
- OCSP
- SSL/TLS
- TLS 1.2
- Vulnerability
- SSL 3.0
- TLS 1.1
- TLS 1.0
- Firefox
- SHA2
- Chrome
- BEAST
title: It’s Time for TLS 1.2

aliases:
- /2013/09/19/its-time-for-tls-1-2/

---
In a previous post titled _[Getting the Most Out of SSL Part 2][1]_, we touched on the recommendation that Web servers be configured to prefer Transport Layer Security (TLS) version 1.2. With the planned release of Firefox 24 and recent release of Chrome 29 adding support for TLS 1.2, now is a great time for website administrators to make the switch.

Transport Layer Security was formerly called Secure Sockets Layer (SSL) and is the protocol that enables secure “https://” connections to websites. TLS 1.2 was defined 5 years ago in RFC 5246, and TLS 1.1 dates all the way back to RFC 4346 in 2006. Both of these versions are updates to the original standard that fix bugs and problems including vulnerability to cipher block chaining (CBC) such as the BEAST attack that made news in 2011. The authors also added newer cipher suites including a replacement for RC4, a popular cipher that has been shown to be susceptible to attack. In short, enabling TLS 1.2 is like a Windows software update – it fixes potential problems and makes your website more secure.

In 2011, statistics from Qualys showed that an overwhelming majority of web servers support TLS 1.0, with almost no support for TLS 1.1 or 1.2. Since then, support for 1.1 and 1.2 in browsers has improved greatly with the current version of all major browser now supporting 1.2. Unfortunately, both the browser and server must support a given version of TLS to enable its use. You can find out if your website currently supports TLS 1.2 using this [SSL Configuration Checker](https://casecurity.ssllabs.com/).

By taking the time to enable TLS 1.2 on your web server, you can benefit in a couple of ways. If you don’t have TLS 1.1 enabled, then you will gain resistance to the BEAST attack. With TLS 1.2 you will also gain more secure cipher suites that reduce reliance on RC4. The recently disclosed RC4 weakness isn’t yet practical to exploit because it requires the attacker to observe millions of connections, but you should expect that to change. You will also gain stronger ciphers that prepare your site in the event that new vulnerabilities are found in the older protocols or other older ciphers. If you are still relying on SSL 3.0 (the predecessor to TLS 1.0), then you can add better performance to the list of benefits because TLS will allow you to enable OCSP stapling.

Enabling TLS 1.2 on your site also helps to solve the “chicken and egg” problem that currently exists. Browsers are beginning to enable TLS 1.2 by default, but in a small number of cases this can actually cause problems for users connecting to sites that don’t support TLS 1.2 because they don’t properly negotiate to a different version of the protocol.

The steps required to enable TLS 1.2 vary depending on your web server software and version. It may be a matter of updating a configuration setting, or you may need to upgrade your server software. A web search for “TLS 1.2” and your web server should provide the information you need.

Just as Certificate Authorities are moving to longer key sizes and SHA2 before a serious vulnerability is found and exploited, turning on TLS 1.2 is a way that you can future-proof your website and help to move internet security forward.

 [1]: https://casecurity.org/2013/06/28/getting-the-most-out-of-ssl-part-2-configuration/