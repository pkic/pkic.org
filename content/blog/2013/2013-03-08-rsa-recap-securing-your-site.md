---
title: RSA Recap – Securing Your Site
authors: [Ben Wilson]
date: 2013-03-08T17:45:55+00:00
dsq_thread_id:
  - 1963684654
tags: [RSA]


---
At RSA last week a few of us participated in panel discussions that focused on SSL/TLS. During the panel that I moderated on Friday, one theme we addressed was secure server configuration. One of CASC&#8217;s goals is to help harden existing SSL/TLS implementations against vulnerabilities—because most SSL/TLS exploits arise from suboptimal website configurations. These vulnerabilities and attacks can be mitigated or even eliminated with proper server configuration and good website design.

## Server Configuration (or Load Balancer Configuration, if that is where your SSL connection terminates)

Security threats can be minimized by selecting the right cryptographic protocols. First, SSL version 2 should be disabled because among other vulnerabilities, SSL v2 has no protection for the SSL handshake, thus allowing a man-in-the-middle to hijack the session. TLS version 1.2 is the current protocol specification. While implementing TLS v1.2 does not negate the need for strong key sizes, or a publicly trusted certificate (instead of a self-signed one) from a CA with robust operational procedures, TLS v1.2 is the preferred way of defending against newly discovered attacks like those that exploit vulnerabilities in TLS session renegotiation, Browser Exploit Against SSL/TLS (BEAST), and other man-in-the-middle attacks, and you can always patch your servers to prevent insecure session renegotiation. (Unfortunately, some system administrators have simply disabled server-side renegotiation as a temporary workaround, but this is not the solution, it does not provide the permanent security benefits of TLS v1.2.) 

Because server configurations differ by platform and deployment model, there is no universal way to configure your web server to prevent insecure renegotiation, so we&#8217;ll have to provide more detailed configuration steps in a future blog post. Meanwhile, you should test your server using [https://casecurity.ssllabs.com/](https://casecurity.ssllabs.com/) to make sure your server does not allow insecure renegotiation. Also, to protect against the types of attacks discussed above, you should configure your server by disabling null ciphers and MD5 while preferring [more secure TLS 1.2 cipher suites](https://www.openssl.org/docs/apps/ciphers.html#TLS_v1_2_cipher_suites) that will cause TLS 1.2 clients to use them, and yet include others to still allow any TLS 1.1-compliant or older clients to still fall back to encryption ciphers that are considered &#8220;strong.&#8221; (RC4 is no longer considered strong, but it doesn’t use CBC mode, so it might be used to protect a legacy system against BEAST.)

Finally, in 2012 a new exploit was documented—&#8221;Compression Ratio Info-leak Made Easy (CRIME).&#8221; To protect against this exploit, which derives the secret session key from observations about changes in the size of compressed request payloads, simply disable TLS compression. The [“Ciphers” page at OpenSSL](https://www.openssl.org/docs/apps/ciphers.html) will help you configure secure TLS 1.2 if use Apache or nginx, and for IIS, take a look at [MS Knowledgebase Article 245030](https://support.microsoft.com/kb/245030).

## Good Website Design

The CASC recommends that customers scan their websites for vulnerabilities to cross-site-scripting (XSS) and that they implement secure cookies and consider [HTTP Strict Transport Security (HSTS)](https://developer.mozilla.org/en-US/docs/Security/HTTP_Strict_Transport_Security) and Content Security Policy (CSP). 

First, XSS vulnerabilities are created when web pages allow the client to inject an untrusted data flow into web page processes. Proper web site design forces untrusted client data to be &#8220;escaped&#8221; with encoding appropriate for the script used on the web page. JavaScript, HTML, URLs, CSSs, and other web design elements use escape codes to enclose or &#8220;bracket&#8221; untrusted data and prevent it from corrupting data flowing through trusted processes. See [this OWASP article](https://www.owasp.org/index.php/Cross-site_Scripting_%28XSS%29) for more information on XSS.

Second, the newer variety of man-in-the-middle attacks use exfiltrated data such as insecure cookies and other session data to impersonate user connections. For example, Firesheep, a Firefox browser extension released in 2010, sniffs wi-fi networks and intercepts unsecured user cookies, and BEAST, discussed above, uses JavaScript with a network sniffer to hijack session cookies. Cookies should be configured with a &#8220;Secure&#8221; attribute that is set to &#8220;True.&#8221; 

HSTS and CSP are two ways to mitigate the leak of information to an attacker. With HSTS (sometimes referred to as [Always On SSL](https://www.otalliance.org/resources/AOSSL/index.html)), you add an HTTP header, which is received over HTTPS and processed by the client at the transport layer and stored for use in future communications with your site. Future attempts to load via HTTP will be replaced by HTTPS. Similarly, the [W3C&#8217;s candidate recommendation Content Security Policy](http://www.w3.org/TR/CSP/) communicates security instructions to the application layer. The security policy header then specifies the security-relevant information that browsers should expect to see when they attempt to communicate with the web site, and site operators can even configure alerts when browsers encounter certain unanticipated SSL-related events. 

Overall, the RSA sessions this year were particularly helpful and informative on available ways to mitigate and prevent attacks on the security of SSL communications. 

Ben Wilson, General Counsel & Senior Vice President of Industry Relations, DigiCert