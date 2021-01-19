---
title: What Kind of SSL/TLS Certificate do You Need?
authors: [Ben Wilson]
date: 2016-05-12T17:00:17+00:00
dsq_thread_id:
  - 4819537197


---
In previous blog [posts][1] we have discussed the differences among the various types of SSL/TLS certificates available. In this blog post we introduce you to a new [infographic][2] that has a decision tree to help you select the right kind of certificate for your needs.  In most cases you will need a publicly trusted certificate, but the decision tree notes that one type of certificate is the private trust certificate, which can be obtained and used in situations where a publicly trusted certificate cannot be used. These types of private SSL/TLS certificates chain to a root certificate that is not embedded in the key stores of browsers and other similar software, but apart from that branch, the decision tree is an aid to server administrators looking to buy one or more publicly trusted SSL/TLS certificates.

The first step in the process is to determine the level of trust that you want to communicate to end-users. In other words, how would you like to communicate about your brand or company name in the certificate?  Each level of certificate communicates a varying degree of information about your domain name and your company. At the basic level, a domain-validated (DV) certificate offers session security and privacy, but only attests to the domain, that is, only “[www.example.com.][3]”  At the next level, an enhanced, organizational-validated (OV) certificate includes not only what is in a DV certificate, but also information about the organization that owns or controls the domain.  Finally, at the highest level, is the extended validation (EV) certificate. It is issued only after the certification authority has completed additional checks on the certificate request and the organization requesting the certificate.

After deciding on the type of certificate desired, purchasers need to evaluate how many domains they will be seeking to protect.  The decision tree in the new infographic guides you through the process of  selecting a single-domain certificate, a multi-domain certificate, or a wildcard certificate in combination with the DV, OV or EV certificate type.  For instance, wildcard certificates are available for DV and OV certificates, but currently are not available for EV certificates.

In conclusion, there  are many options when it comes to buying SSL/TLS certificates,  and sometimes the choices can be confusing.  This new infographic provided by the CA Security Council will help you refine your choice as you make it through the SSL/TLS Certificate selection process.

 [1]: https://casecurity.org/2013/05/24/getting-the-most-out-of-ssl-part-1-choose-the-right-certificate/
 [2]: https://casecurity.org/ssltls-certificate-infographic/
 [3]: http://www.example.com.