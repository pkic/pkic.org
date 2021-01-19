---
title: Encryption Still Works – It’s About How You Implement It
authors: [Ben Wilson]
date: 2013-09-13T17:04:21+00:00
dsq_thread_id:
  - 1937290916


---
The September 5th joint article by the New York Times and Guardian newspapers on NSA&rsquo;s and GCHQ&rsquo;s efforts to circumvent encryption implementation have left many people speculating on the security of the data they are transmitting over the Internet. Hopefully, this blog post will provide some guidance and help understand SSL in light of these recent articles. Importantly, the articles point out that the primary means of attacking SSL/TLS do not exploit a vulnerability in the protocol itself but instead aim to exploit poor implementations of the protocol, insecure servers, and weak cryptography.

Here are just a few recommendations that companies can take to ensure their implementation of SSL/TLS is secure:

1. **Use Publicly Trusted SSL/TLS Certificates to Encrypt Your Communications** &ndash; Publicly trusted SSL/TLS certificates provided by members of the CA Security Council provide greater transparency and interoperability than self-signed certificates. SSL/TLS encryption is still fundamentally strong and it provides better security for communications over the Internet than anything else currently available. As Bruce Schneier noted in follow-ups to these articles, &ldquo;while it&#8217;s true that the NSA targets encrypted connections &ndash; and it may have explicit exploits against these protocols &ndash; you&#8217;re much better protected than if you communicate in the clear,&rdquo; &ldquo;trust the math,&rdquo; and &ldquo;encryption is your friend.&rdquo; ****He went on to point out that &ldquo;it&rsquo;s harder for the NSA to backdoor TLS &hellip; because any vendor&rsquo;s TLS has to be compatible with every other vendor&rsquo;s TLS.&rdquo; That said, you should still double check your information flows and ensure that attackers cannot exfiltrate data before or after it has been sent over SSL/TLS.

Note that if you generate the SSL key pair yourself (the most common model), your private key won&rsquo;t be shared with anyone. That means that the CA that issues your certificate cannot in any way assist the government in decrypting your traffic.

2. **Patch or Upgrade Your Systems** &ndash; Keep networked systems updated with security patches and fixes that protect them against newly discovered vulnerabilities. Do not assume that any server, firewall, router, or other network device is maintenance-free. Most software (and firmware) is regularly updated, so implement a patch management plan that does not create any unnecessary delays to applying patches or upgrades. Seriously consider upgrading systems to the most current generation available from each vendor because, as protocols improve and newer cipher suites are introduced, only newer systems support them.

3. **Deploy Stronger Crypto** &ndash; As noted above, these recent articles hint at the government&rsquo;s ability to break weak crypto. In fact, members of the CA Security Council are currently helping their customers migrate away from 1024-bit RSA and SHA1 and encouraging the use of 2048-bit RSA with SHA2 or 384-bit Elliptic Curve Cryptography, which can provide better security when properly implemented.

Implement TLS v. 1.2, and disable SSL 2.0. Seriously consider forcing connections to use TLS 1.1 or better if you have control or influence over the clients that will connect to them.

Review ciphersuite configurations for servers and other network devices, giving priority to the ciphersuites that provide better encryption of the information communicated by your organization. Just as an example, give priority to AES in Galois Counter Mode (AES-GCM) because weaknesses in Cipher Block Chaining (CBC) mode have been the subject of various academic attacks during recent years and TLS\_RSA\_WITH\_AES\_256\_GCM\_SHA384 provides 256 bits of encryption and uses the SHA384 algorithm instead of SHA1.

Because older clients will not be able to connect to your server if you eliminate all weak ciphersuites, be cautious when tweaking your ciphersuite configurations. Additional recommendations are available in a previous CA Security Council article available at <https://casecurity.org/2013/06/28/getting-the-most-out-of-ssl-part-2-configuration/>.

4. **Scan and Fix Other Vulnerabilities** &ndash; There are many other pitfalls that can exist if they are not discovered and repaired. Servers are just as susceptible to infection and malware as household PCs, and some types of system compromise will allow attackers to enter through a backdoor, and if not, they might instead compromise the security of communications at the other end &mdash; on a customer&rsquo;s computers. So besides taking steps to ensure the protection of the cryptographic private key used to create SSL/TLS communications, your organization should install a service that regularly scans your servers and network devices for vulnerabilities &mdash; both from inside-out and outside-in, because sometimes these vulnerabilities arise from poor design on the backend. On the front end, scan and remediate at least the OWASP Top Ten Vulnerabilities &mdash; injection flaws, cross-site scripting, and poor authentication management (including insecure session cookies).

When properly implemented, SSL/TLS remains the single most important security mechanism for ensuring end-to-end authentication and encryption of data available. However, just as a precaution in light of these recent Snowden disclosures, all entities should revisit and check on the security of their network systems and upgrade them as necessary. It will be time and money well spent.