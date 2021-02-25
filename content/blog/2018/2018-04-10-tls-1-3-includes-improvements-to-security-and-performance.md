---
authors:
- Tim Shirley
date: "2018-04-10T17:55:05+00:00"
dsq_thread_id:
- 6606123721
keywords:
- internet engineering task force
- https
- forward secrecy
- tls
- tls 1.3
- tls 1.2
- ietf
- vulnerabilities
tags:
- IETF
- SSL/TLS
- Forward Secrecy
- TLS 1.3
- TLS 1.2
- Vulnerability
title: TLS 1.3 Includes Improvements to Security and Performance


---
Last month saw the final adoption, after 4 years of work, of TLS version 1.3 by the Internet Engineering Task Force (IETF). This latest iteration of the protocol for secure communications on the internet boasts several noteworthy improvements to both security and performance:

## Security

All cipher suites that do not provide forward secrecy have been eliminated from TLS 1.3. This is a very important security property, because without forward secrecy, if a server’s private key is compromised today, any previously-recorded conversations with that server dating back as long as the key was in use could be decrypted. While it is possible (and highly recommended) to configure a server with TLS 1.2 to prefer (or only support) cipher suites that provide forward secrecy, under TLS 1.3 these are the only option. Other cryptographic modernizations in TLS 1.3 include the elimination of DSA, custom DHE groups, and compression.

TLS 1.3 features a new version downgrade protection to guard against vulnerabilities like [POODLE][1]. Specifically, if a client claims to only support an earlier version of TLS, the server is required to include a defined value in its handshake response, and TLS 1.3-supporting clients are required to reject handshakes that include the defined value. This protects against an active attacker triggering a version downgrade, since this data is signed and thus cannot be modified by an attacker without detection.

## Performance

One of the few remaining barriers to HTTPS-everywhere is that the initial connection to an HTTPS site is slower than a connection to a comparable HTTP site. With TLS 1.2, there are several round-trip messages required for the client and server to negotiate the terms of their secure communication. TLS 1.3 reduces the number of round-trip messages, enabling the two systems to start communication actual data much more quickly. In fact, in the case of a session resumption, TLS 1.3 introduces a 0-RTT (Round Trip Time) option that allows actual data to be sent in that first communication (encrypted using the parameters used previously.) This particular optimization does come with a security tradeoff, as it enables an attacker to replay a previous legitimate message. This is a problem with which secure web applications already need to deal, however, so it should be a safe thing to do in most cases.

When TLS 1.2 rolled out, there were compatibility issues introduced due to various devices and applications not correctly implementing the specification. With the lessons learned from that deployment and from browser implementations of earlier drafts of the specification, the roll out of TLS 1.3 is expected to be much smoother. Early data suggests that enabling TLS 1.3 will not increase the number of handshake failures. However, as with any such update, it will take time before its benefits are fully realized and support for older versions of TLS can be retired. The previous version of TLS (version 1.2) was released in 2008, and still most websites support older versions of TLS so that older clients are still able to access their site. Still, this is an important milestone in the journey towards a faster and more secure internet.

 [1]: https://en.wikipedia.org/wiki/POODLE