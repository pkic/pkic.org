---
authors:
- Rick Andrews
- Bruce Morton
date: "2014-04-11T16:30:26+00:00"
dsq_thread_id:
- 2604243236
keywords:
- rc4
- openssl
- forward secrecy
- tls
- tls 1.2
- dh
- 3des
- ecc
- elliptic curve
- rsa
- ecdh
- ssl
tags:
- RC4
- OpenSSL
- Forward Secrecy
- SSL/TLS
- TLS 1.2
- DH
- 3DES
- ECC
- RSA
- ECDH
title: Perfect Forward Secrecy


---
Recent revelations from Edward Snowden about pervasive government surveillance have led to many questions about the safety of communications using the SSL/TLS protocol. Such communications are generally safe from eavesdroppers, as long as certain precautions are observed. For example, configuring your web server to avoid using SSL2 and SSL3, favoring newer versions of TLS like TLS 1.2, selecting strong ciphersuites, etc.

But even if your server is configured properly, you still must secure the private key associated with your SSL certificate. In nearly all cases, the web site owner generates their key pair and sends only the public key to their Certification Authority (CA). The CA (and any eavesdropper) sees only the public key, and the private key cannot be derived from that. So the CA cannot reveal a web site owner’s private key to the government or an attacker, even if coerced to do so.

After your SSL certificate has expired and been replaced with a new key pair and certificate, it’s still important to secure or destroy the old private key, because attackers have the ability to save old SSL-protected traffic. In many cases, an attacker with a private key and saved SSL traffic can use the private key to decrypt all session keys negotiated during saved SSL handshakes, and then decrypt all saved session data using those session keys.

But not if the web server and its clients agree to use a key agreement protocol that offers support for [Perfect Forward Secrecy (PFS)][1]. First let’s look at how things work without PFS. The client generates a random number and sends it to the server, encrypted it with the public key of the server. Only the server can decrypt it, so now both sides have the same random number. They use a key generation algorithm to derive the session key from that random number. But an attacker who knows the server’s private key can also decrypt the random number, apply the same key generation algorithm, and arrive at the same session key. The attacker can then decrypt any saved SSL session data.

Using PFS, there is no link between the server’s private key and each session key. If both client and server support PFS, they use a variant of a protocol named Diffie-Hellman (after its inventors), in which both sides securely exchange random numbers and arrive at the same shared secret. It’s a clever algorithm that prevents an eavesdropper from deriving the same secret, even if the eavesdropper can view all the traffic. See [this Wikipedia article][2] for a clear explanation of how this works, and this [blog post][3] for a more detailed technical explanation. Note that if the ephemeral variant of Diffie-Hellman is used, no part of the exchange is encrypted with the web server’s private key. That means that an attacker who obtains the private key cannot decrypt any saved sessions that were established using PFS.

The variants of Diffie-Hellman are known as Diffie-Hellman Ephemeral (DHE) and Elliptic Curve Diffie-Hellman Ephemeral (ECDHE). You’ll see those terms within the names of TLS ciphersuites that can be configured for use in your web server. For example, Ivan Ristić of SSL Labs [recommends][4] the following:

  * TLS\_ECDHE\_RSA\_WITH\_RC4\_128\_SHA
  * TLS\_ECDHE\_RSA\_WITH\_AES\_128\_CBC_SHA
  * TLS\_ECDHE\_RSA\_WITH\_AES\_256\_CBC_SHA
  * TLS\_ECDHE\_RSA\_WITH\_3DES\_EDE\_CBC_SHA

Please note that there are more options available which may have to be used as the industry moves to ECC certificates, TLS 1.2 and GCM suites. Also note that you may see ciphersuites with DH (not DHE) and ECDH (not ECDHE) in their names – these are variants of Diffie-Hellman that do not exhibit the Perfect Forward Secrecy property. Only DHE and ECDHE support PFS at this time.

Ristić also provides information on how to [configure PFS support on Apache, Nginx and OpenSSL][5]. If you want to see if your server supports PFS, test it at the CA Security Council’s [SSL Configuration Checker][6].

Do the browsers support PFS? Yes they do. At this time, Chrome, Firefox, IE, Opera and Safari all support PFS when using ECDHE cipher suites with RSA and ECC SSL certificates. All browsers except IE also support DHE with RSA certificates. You can also [test your browser][7] to see if it supports PFS. If your web site needs to support older browsers that may not support PFS, you’ll have to configure your web server to also offer non-PFS suites. But list PFS suites first in order of preference.

PFS is a mature technology that is built in to nearly all major browsers and web servers. It’s available for use in securing your SSL traffic both now and in the future.

 [1]: https://en.wikipedia.org/wiki/Perfect_forward_secrecy
 [2]: http://en.wikipedia.org/wiki/Diffie_hellman#description
 [3]: http://vincent.bernat.im/en/blog/2011-ssl-perfect-forward-secrecy.html
 [4]: http://blog.ivanristic.com/2013/06/ssl-labs-deploying-forward-secrecy.html
 [5]: http://blog.ivanristic.com/2013/08/configuring-apache-nginx-and-openssl-for-forward-secrecy.html
 [6]: https://casecurity.ssllabs.com/
 [7]: https://www.ssllabs.com/ssltest/viewMyClient.html