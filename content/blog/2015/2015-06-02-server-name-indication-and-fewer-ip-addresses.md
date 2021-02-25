---
authors:
- Bruce Morton
date: "2015-06-02T17:30:03+00:00"
dsq_thread_id:
- 3814748897
keywords:
- chrome
- ssl
- attack
- tls
- mitm
tags:
- Chrome
- SSL/TLS
- Attack
- MITM
title: Server Name Indication and Fewer IP Addresses


---
You have a dilemma. You want to continue to deploy your web service but are running out of IPv4 addresses. You consider deploying multiple virtual servers that will use the same IP address. However, your thought is that you can only have one SSL certificate per IP address. How will you make your service secure?

[Server Name Indication (SNI)][1] is an extension to the SSL/TLS protocol that allows the browser or client software to indicate which hostname it is attempting to connect. SNI is defined in [RFC 6066][2].

By supporting SNI at the server, you can present multiple certificates and support multiple servers at the same IP address. Since the client indicates the hostname, the server can select the correct certificate to complete the SSL handshaking process.

For SNI to be effective, it must be implemented by the [majority of browsers][3], which thankfully is the case today. If a browser does not support SNI, then a default certificate will be presented. If the certificate does not support the domain, then a certificate warning will be seen. Of course, there will be no warning if the certificate is a wildcard supporting the requested subdomain.

SNI can abort a connection in some man-in-the-middle (MITM) attacks. For instance, if the browser requests a connection to the server with a specific domain name, but receives a certificate that does not support the proper name, then a certificate warning will appear which could indicate a MITM attack.

SNI can be deployed with many certificates or one certificate. Many certificates would just mean that individual certificates would be installed to support each domain name. Alternatively you might want to group related sites together and leverage one certificate; [a wildcard or multi-domain certificate][4] for example. The multi-domain certificate allows many domain names to be added to the subject alternative name (SAN) field with a light performance cost due to the size of the certificate. As more domains are added, the multi-domain certificate can be updated, or new certificates can be added.

The disadvantage is SNI is not supported by all clients such as Windows XP. Consequently, Internet Explorer running on XP will not work, and although Windows XP is no longer officially supported, Microsoft does offer special long-term support for enterprises willing to pay. Alternative browsers will help mitigate the XP problem as Chrome, Firefox and Opera will all support SNI on XP.

An alternative to supporting security with fewer IP addresses is not to deploy SNI, but use a single multi-domain certificate. This solution is limited if the domain names are owned or controlled by different entities. There can also be a certificate management issue as the multi-domain certificate will have to be updated every time a new domain needs to be supported.

The advantage of SNI is scalability. SNI will allow you to deploy SSL with fewer IP addresses and fewer servers. It will allow unique certificates to be used for different sites, identities and brands which may improve security and trust. As we see Windows XP users fade away, SNI will be the best alternative to support many domains with fewer IP addresses.

 [1]: https://en.wikipedia.org/wiki/Server_Name_Indication
 [2]: https://tools.ietf.org/html/rfc6066#section-3
 [3]: https://en.wikipedia.org/wiki/Server_Name_Indication#Implementation
 [4]: https://casecurity.org/2014/02/26/pros-and-cons-of-single-domain-multi-domain-and-wildcard-certificates/