---
authors:
- Bruce Morton
- Erik Costlow
date: "2013-12-09T16:00:15+00:00"
dsq_thread_id:
- 2030893091
keywords:
- pdf
- identity
- code signing
tags:
- PDF
- Identity
- Code Signing
title: Java Secures Supply Chains Through Code Signing


---
We have recently discussed the benefits of code signing in two posts: [Securing Software Distribution with Digital Signatures][1] and [Improving Code Signing][2]. These posts covered the role of code signatures as a “digital shrinkwrap” designed to answer a simple question: Did the software I am about to run actually come from the author or has someone changed it along the way?

As software is downloaded, assembled, copied, distributed and redistributed, it can be [modified at any point along the supply chain][3]. Some modifications are designed to insert advertising into software, others add tracking capabilities, and others could be more nefarious, such as compromising the entire host or stealing data.

Cryptographic code signatures are not designed to protect against piracy, rather they are for authenticity; to prove that software came from its author and has not been altered.

Code signatures protect all parties from this threat. End-users can validate the signature to determine that it came from the publisher and was not modified by anyone along the way. Similarly, the publisher can mathematically prove that their code was not modified as it went through the supply chain, such as by a reseller or the actual customer. In September 2013, Oracle announced that [Java 7 update 51 (January 2014) will require valid code signatures][4] for Applet & Web Start applications. This is a positive step for security overall as it:

  * Allows end-users to run applications from publishers they trust
  * Protects end-users from applications where identity cannot be verified
  * Ensures indications where legitimate applications have been tampered with (i.e., tampering would break the signature).

Oracle has also made improvements in Java’s code signatures, such as separating the role of identity and permissions. In the past, signed applets affected the level of permissions to determine what an applet could do: unsigned applets ran in a sandbox and signed applets were granted all-permissions. As of [Java 7 update 21][5] (April 2013), Oracle separated the role of identity and authorization to allow signing of sandboxed code. By doing this, software publishers can use the same cryptographic signatures of sandbox applications used to protect high-privileged ones.

The expanding importance of code signatures also pertains to software assembly and defends against attacks like [Cross-Build Injection][6]. As applications have grown to [involve more third-party][7], open-source or commercial components, there is concern to ensure that the binary artifacts that run are the same as what the publisher provided. While the Java changes discussed previously focus on protecting both end-users and developers of Applet & Web Start applications, the code-signing techniques can also be applied for back-end and server-side applications.

Given the [popularity of the Java platform][8] and its [role behind many applications][9], this large-scale use of code signatures is significant for the future of Public Key Infrastructure and trusted identity.

 [1]: https://casecurity.org/2013/10/16/securing-software-distribution-with-digital-code-signing/
 [2]: https://casecurity.org/2013/11/14/improving-code-signing/
 [3]: http://www.gao.gov/assets/590/588736.pdf
 [4]: https://blogs.oracle.com/java-platform-group/entry/new_security_requirements_for_rias
 [5]: http://www.oracle.com/technetwork/java/javase/7u21-relnotes-1932873.html#apsign
 [6]: http://branchandbound.net/blog/security/2012/03/crossbuild-injection-how-safe-is-your-build/
 [7]: http://blog.sonatype.com/people/wp-content/uploads/2012/03/2012-sonatype-survey-findings-PDF.pdf
 [8]: http://adtmag.com/articles/2013/08/15/java-most-popular-2013.aspx
 [9]: http://www.wired.com/wiredenterprise/2013/09/the-second-coming-of-java/