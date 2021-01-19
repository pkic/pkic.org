---
title: Reducing the Impact of Government Spying
authors: [Jeremy Rowley]
date: 2014-04-04T17:00:55+00:00
dsq_thread_id:
  - 2586074339


---
Last year, Edward Snowden, an American computer-specialist working as a contractor for the National Security Agency (&ldquo;NSA&rdquo;), shocked web-users around the world by publicizing documents showing that the NSA was gathering intelligence on Internet users. The realization that the US government was gathering sensitive information has led to a worldwide demand for better protection of online communication and data and a general worry about the effectiveness of existing infrastructures. Specifically, some entities have asked whether PKI is still a robust way to protect online information.

Fortunately, respected cryptographers, such as Bruce Schneier, have examined the issue and gone on record defending the strength of current encryption systems. Schneier insists that &ldquo;encryption works<a href="#_ftn1" name="_ftnref1" title="" id="_ftnref1">1</a>&rdquo; and that he, &ldquo;trust[s] the mathematics<a href="#_ftn2" name="_ftnref2" title="" id="_ftnref2">2</a>&rdquo; behind present encryption technology.

We support the conclusion that existing encryption technologies are still effective against both government and private bad actors. However, the effectiveness is highly dependent on proper deployment and configuration of the technology. To help ensure a safe Internet, Certificate Authorities (&ldquo;CAs&rdquo;) worldwide are focused on educating users about how to effectively deploy and use these tools, including the proper use of Secure Sockets Layer and Transport Layer Security (&ldquo;SSL/TLS&rdquo;) technology to protect information in transit.

As part of these education efforts, the CA Security Council (&ldquo;CASC&rdquo;) recommends the following precautions:

  1. **SSL/TLS Configuration and Deployment**. Websites should deploy digital certificates that use a SHA2 hash algorithm and 2048-bit or higher key sizes. Server operators should also require TLS 1.1 or 1.2, secure cookies, and secure cipher suites (not RC4). Administrators should periodically scan and analyze their organizations&rsquo; networks to identify identifying weak, rogue, or expiring certificates and update them as necessary. Most CAs offer tools to their customers designed to detect issues and evaluate their SSL/TLS deployment. Administrators should contact their CA representative to find out more. 
  2. **Key Protection**. Website operators should take great care in protecting their private keys. Bad actors rely heavily on poor configuration, insecure servers, and other work-arounds to compromise communication and encrypted information. Better protection of private keys, through secure key storage or devices, makes compromising this data much more difficult. 
  3. **Always-On SSL**. Always-On SSL is an approach to securing end-user security during the user&rsquo;s entire website visit. Always-On SSL mitigates session hijacking and man-in-the-middle attacks, supports end-to-end encryption, and provides users with website owner identification.
  4. **Perfect Forward Secrecy**. Some SSL/TLS deployments permit a bad actor to capture encrypted traffic and then decrypt this data once the private key is obtained through a subpoena or key compromise. Perfect forward secrecy prevents this future decryption of stored data by generating truly ephemeral session keys. Website operators should enable perfect forward secrecy and ensure ECDHE and DHE suites at the top of their cipher suite list.
  5. **Code Securely**. Users who build applications for their company should sign their code using a publicly trusted certificate. Before signing, scan code for malware and potential back doors. Code signing private keys should be stored securely, preferably on a hardware token. Signed code should be time-stamped in case the certificate is later revoked. 
  6. **Up-to-Date Systems**. Users should always ensure they have up-to-date browsers, servers, firewalls, routers, and software with patches to protect their system from vulnerabilities. Server operators should evaluate patches to ensure they are completely protected from security risks. 

The above steps are just a few examples of things server operators and users can do to ensure they are operating securely, free from spying by both government actors and bad actors. We encourage everyone to reach out to their CA and ensure they are following best practices and get assistance in ensuring their systems are properly protected and operated.

[](#_ftnref1)1 Drinkwater, Doug. &ldquo;RSA 2014: Bruce Schneier Champions Encryption in &lsquo;Golden Age&rsquo; of Government Surveillance.&rdquo; Web log post. _Schneier on Security_. Bruce Schneier, Feb. 25, 2014. Mar 26, 2014. <[https://www.schneier.com/blog/archives/2013/09/the_nsas_crypto_1.html](https://www.schneier.com/blog/archives/2013/09/the_nsas_crypto_1.html)>

[](#_ftnref2)2 Schneier, Bruce. &ldquo;The NSA&rsquo;s Cryptographic Capabilities.&rdquo; Web log post. _Schneier on Security._ Bruce Schneier, Sep. 6, 2013. March 26, 2014. <[https://www.schneier.com/blog/archives/2013/09/the_nsas_crypto_1.html](https://www.schneier.com/blog/archives/2013/09/the_nsas_crypto_1.html)>