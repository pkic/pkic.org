---
title: All You Need to Know About the RC4 Encryption Scheme
authors: [Rick Andrews]
date: 2013-03-14T21:12:28+00:00
dsq_thread_id:
  - 1958594618


---
The [latest published attacks][1] target specific algorithms used within SSL/TLS. Those algorithms are used when a client connects to a server via SSL/TLS; they&rsquo;re not used when a Certificate Authority signs a certificate. The attacks demonstrate potential weaknesses in the use of the algorithms.

While interesting, the attacks don&rsquo;t represent an immediate practical threat to users of SSL/TLS (including online banking, e-commerce, social networking, etc.). Such attacks require an attacker to run malicious software on a user&rsquo;s computer which would connect to a particular web site and send the same message over and over again many times. In fact, if the attacker&rsquo;s software could send the same message over and over 10 times per second, it would still take more than 3 years for the attack to succeed.

The designers of the SSL/TLS protocol anticipated that algorithms would become weaker over time, so the protocol was designed to support the easy addition of new algorithms. Hence a weakness in one algorithm does not mean that SSL/TLS is broken. Newer, stronger algorithms have already been developed and incorporated into the latest implementations of SSL/TLS. What&rsquo;s needed now is for users of web server and browser software to update to the newest versions to minimize or eliminate the use of weakened algorithms.

The fact remains, SSL/TLS is still the most scalable, efficient cryptographic protocol available now and, with the number of researchers focused on its protocols, will only continue to get stronger in the future.

Members of the CASC remain committed to the promotion of best practices and education that advance internet security, as evidenced by the active participation of member companies at the recent RSA conference. We will continue to promote proper SSL configuration and other practices that reduce vulnerabilities and attack vectors wherever possible.

Rick Andrews, Technical Director, Symantec

 [1]: http://www.forbes.com/sites/andygreenberg/2013/03/13/cryptographers-show-mathematically-crackable-flaws-in-common-web-encryption/