---
title: An Introduction to OCSP Multi-Stapling
authors: [CA Security Council]
date: 2013-05-07T21:03:01+00:00
dsq_thread_id:
  - 1955712788
tags:
- OCSP
- CRL
- IETF
- Revocation

---
### OCSP Stapling

[OCSP](http://tools.ietf.org/html/rfc2560) is a protocol used to check the validity of certificates to make sure they have not been revoked. OCSP is an alternative to [Certificate Revocation Lists (CRLs)](http://tools.ietf.org/html/rfc5280#section-5). Since OCSP responses can be as small as a few hundred bytes, OCSP is particularly useful when the issuing CA has relatively big CRLs, as well as when the client has limited memory and processing power.

OCSP can also provide much more timely information than CRLs about the status of a certificate since the information is generally fetched more frequently. Additionally, OCSP can report if the CA actually issued a certificate. This is not possible with a CRL since a CRL only contains a list of revoked serial numbers whereas OCSP responders are provided the serial number to check. Therefore, it is possible to immediately detect the usage of certain kinds of fraudulently issued certificates.

OCSP does have a few downsides. First, the client (usually a web browser) must fetch the response itself, which can introduce delays into the [TLS](http://tools.ietf.org/html/rfc5246) handshake with the server and cause the user to wait (slightly) for the webpage to display. Second, because every client visiting a website will request an OCSP response for the server they visit, the number of requests to the responders will depend on the number of users of all the sites. If large sites are numbered among the CAs customers, the CA must build a significant infrastructure to handle all those requests. Finally, hiccups in this infrastructure could make the client doubt if the certificate is valid if a response is unavailable.

Competition among browsers has made it necessary to largely ignore OCSP response failures, creating a security vulnerability.

To overcome the delay and performance issues, the [Internet Engineering Task Force&#8217;s](http://www.ietf.org/) [TLS Working Group](http://datatracker.ietf.org/wg/tls/) defined a [Certificate Status extension](http://datatracker.ietf.org/wg/tls/) of the TLS Protocol, commonly referred to as &ldquo;OCSP Stapling.&rdquo; OCSP stapling uses the TLS server as a proxy for the client by fetching the OCSP response for its site certificate and passing the response on to clients that ask for the response as part of the TLS handshake. Because the response is obtained directly from the server, the client does not need to request information from the issuer, resulting in increased site performance. In addition to client benefits and faster page loads, OCSP stapling mitigates some privacy concerns caused by the client telling the CA which sites a user visit, and also reduces the burden on the issuer by reducing the infrastructure demands. OCSP stapling is currently supported by IIS 7+, Apache 2.4+ (must be manually enabled) and Nginx 1.7.3+.

The main drawback of OCSP stapling is that it increases the website&#8217;s traffic size a little, from a few hundred bytes to two KB per full handshake, depending on the size of the OCSP response. However, this increase is negligible compared to the amount of encrypted data sent over the connection, particularly if the server is well configured and uses resumable SSL/TLS sessions, which will limit the number of full TLS protocol handshakes necessary, reducing costs as the costly private key operation is not necessary when resuming a session.

Another drawback is that the basic OCSP stapling only works for site certificates and does not check the validity of intermediate CA certificates in the certificate chain, which is also a requirement for properly verifying a certificate. This means that clients still have to separately check the CA certificate&#8217;s validity by either downloading CRLs or requesting OCSP responses, depending on what is configured in the certificate. One possible reason for this limitation is that, at the time the Certificate Status TLS extension was defined, intermediate CA certificates did not include OCSP information. However, times have changed, and including OCSP information in intermediates is now required.

To improve stapling and take advantage of these new developments in TLS, I introduced the concept of multi-stapling.

### Multiple OCSP Stapling

CAs are now issuing certificates with at least one intermediate CA in the chain (or, at least, most do), and the CA/Browser Forum Baseline Requirements now require OCSP pointers in intermediate CA certificates. With the necessary support in TLS clients and servers it would be possible to use OCSP stapling for the intermediate CA certificates, too. Checking this information in connection with a stapled OCSP response is referred to as &ldquo;multi-stapling.&rdquo;

Multi-stapling _should_ have been as simple as defining a new method for the Certificate Status extension and including that method in the list of methods supported by the client. Unfortunately, that was not the [case](http://my.opera.com/yngve/blog/2009/10/16/extending-certificate-status-in-tls-extensions).

The Certificate Status extension in TLS did not allow clients to signal support for two methods. This is problematic because clients would have to support both the old and the new stapling methods until all clients could support multi-stapling.

The solution is to include a new extension in the TLS handshake, one that will eventually replace the Certificate Status extension. This new extension is defined in an [Internet Draft](http://datatracker.ietf.org/doc/draft-ietf-tls-multiple-cert-status-extension) (a proposal for a new RFC) that recently completed IETF Last Call and has now been approved by the IESG (the IETF leadership committee).

The new extension fixes several problems by allowing clients to use multiple status checking methods, and allowing servers to forward multiple OCSP responses to the client.

Multi-stapling will have similar benefits and drawbacks as the older OCSP stapling methods. For example, multi-stapling will further reduce overhead for revocation checking by making it unnecessary for the client to fetch any responses from the issuer. The drawback is even more traffic for the website as the size of stapled data will be much larger. Again, this drawback is reduced, and becomes almost negligible, by using TLS Session resume properly.

Some reviewers have also raised concerns about the possibility that the size of the multi-stapling data will introduce handshake delays. The rationale is that if the size of the handshake gets too big, the server will not be able to transmit the entire sequence in a single &ldquo;burst&rdquo; (window) but will have to break it up into multiple segments and wait for the client to acknowledge each segment. This problem is mitigated, or avoided, if the CA keeps their OCSP responses small (about 512 bytes) and avoids using delegated OCSP signing certificates, at least for prefabricated responses.

Although the IETF is moving forward with multi-stapling, widespread deployment of the standard will still take time (recently, in a survey of 567,000 sites, 13.1 percent of sites with certificates that have OCSP specified supported OCSP stapling, representing 7.6 percent of all SSL servers in the survey). First, client and server vendors will need to implement the new methods. Since a redesign may be necessary for some vendors to fully implement multi-stapling, this might be an extensive process. Second, even early adopters will need to have users and websites start using the updated extension. I expect the entire adoption process to take many years since server software traditionally takes longer times to implement non-critical updates.

Even if multi-stapling is in the pipeline, website administrators should not delay rolling out support for the current version of OCSP stapling, as the current version of stapling will still significantly improve the website&#8217;s performance. Based on my research using certificate data gathered by my TLS Prober scanner which can be viewed [here](http://my.opera.com/yngve/blog/index.dml/tag/TLS%20prober) and [here](http://my.opera.com/securitygroup/blog/index.dml/tag/TLS%20prober), at least 80 percent of sites with certificates issued from publicly trusted CAs are using certificates that can be used with OCSP stapling, and 75 percent can be used with multi-stapling.

A switch from client-managed revocation checking to server- proxied revocation information will increase online security by permitting clients to treat missing OCSP information as a serious concern. Also, multi-stapling will immediately increase performance of websites by eliminating the time clients currently need to spend establishing the connections used to download OCSP and CRL information, which can be a significant fraction of the time spent on the handshake with the server.

Guest Contributor: Yngve N. Pettersen, TLS Prober Labs AS