---
authors:
- Patrick Nohe
- Doug Beattie
date: "2020-01-09T21:00:24+00:00"
keywords:
- policy
- encryption
- forward secrecy
- microsoft edge
- cab forum
- tls
- tls 1.2
- tls 1.3
- extended validation
- ssl 3.0
- tls 1.1
- mozilla
- apple
- tls 1.0
- firefox
- pki
- qualified
- chrome
- ssl
- web pki
- identity
- google
- microsoft
- gdpr
tags:
- Policy
- Encryption
- Forward Secrecy
- Edge
- CA/Browser Forum
- SSL/TLS
- TLS 1.2
- TLS 1.3
- EV
- SSL 3.0
- TLS 1.1
- Mozilla
- Apple
- TLS 1.0
- Firefox
- PKI
- Qualified
- Chrome
- Web PKI
- Identity
- Google
- Microsoft
- GDPR
title: The CA Security Council Looks Ahead to 2020 and Beyond


---
## **A whirlwind of activity will cause dramatic shifts across the PKI world in the year ahead**

Suffice it to say that 2019 was filled with challenges and contentiousness as Certificate Authorities and Browsers began to watch their shared visions diverge. The debate around Extended Validation continued as CAs pushed for a range of reforms and browsers pushed to strip its visual indicators. And a ballot to shorten maximum certificate validity periods exposed fault-lines at the CAB Forum.

But while neither of those conversations are over – let alone nearing consensus – a slew of new deadlines, enforcement dates and initiatives look to make 2020 even busier.

We’ll start by outlining some of the major events and trends that are slated to happen (or continue) in 2020 before turning it over to some of the industry’s thought leaders for their predictions about the new year.

Let’s take a look.

## **The deprecation of TLS 1.0 and TLS 1.1 will…**

Scheduled for January 2020, some of the largest, most influential companies on the internet – Microsoft, Apple, Mozilla, Google and Cloudflare – announced their plans to deprecate support for TLS 1.0 and TLS 1.1 this past Summer. This comes on the heels of the PCI DSS deprecating TLS 1.0 in 2018.

TLS 1.0 was originally created as a successor to the fatally flawed SSL 3.0. It was replaced several years later by TLS 1.1. Both versions of the protocol suffer from known exploits that can render connections vulnerable under the right set of circumstances.

TLS 1.2, which was released over ten years ago, is still considered secure as long as the right configurations are made around it. But what’s really driving this deprecation is the push to proliferate TLS 1.3, the most recent version of the standard, which was finally published in the Summer of 2018. 1.3 features myriad improvements over its predecessors, including an abbreviated handshake, a reduction in the size of cipher suites and mandatory perfect forward secrecy. In layman’s terms – it’s just more secure.

The internet should be racing forward to the newest version of the protocol, but a number of intransigent websites and applications have thus far refused to embrace the newer releases. As of the end of last year – when the joint decision to deprecate was being made – only 17% of the Alexa Top 100,000 websites supported TLS 1.3 while just under 23% (22,285) didn’t even support TLS 1.2 yet.

Come January, a lot of those websites, services and applications (far more than just those represented in the Alexa 100K) are going to break across Google, Microsoft, Mozilla, Apple and Cloudflare platforms. If that seems a bit aggressive, it’s actually completely in line with some of the talking points we heard from Google at the CAB Forum this year:

“…users and well-meaning server operators are harmed by… the recalcitrant customers, such as yourself, and wholly rely on Browsers to do the Right Thing by the user and to protect their interests.”

So, try to keep that in mind when things start breaking in a few weeks – it’s all for your own good.

## **Chinese Encryption Laws will create lots of uncertainty**

Over the course of the last several years part of the world’s digital transformation has entailed codifying data rights and restrictions into national laws and regional organizations. We now have an international pantry full of acronym soup – everything from PSD2 and GDPR to CCPA and PIPEDA – companies with global footprints are now contending with a veritable hodge-podge of regulatory and compliance standards.

On January 1, 2020 China’s own encryption law will come into effect. When married with other recent legislation, a potentially onerous situation for international companies looking to do business within China emerges. Coupled with the fact China is one of the largest emerging markets in the world – it’s a potentially sticky situation for any business looking to expand within its borders.

Part of the problem is that clarification is still needed on several fronts. For instance, commercial encryption from international companies must be approved and certified before it can be used in China – but that certification system has yet to be created. Likewise, there is uncertainty with regard to key escrow and what data must be made available to the Chinese government. This has led to a rash of speculation, misinformation and ultimately overreaction. Given how opaque portions of the new regulation still are, many companies are opting to take a wait-and-see approach. This is a wise tactic, assuming your organization doesn’t have a well-versed Chinese legal expert on staff.

## **2020 is the year we fix Extended Validation**

After a difficult 2019, one of the CA Security Council’s top priorities for 2020 will be finding an intuitive way to display website identity information – one of two, clearly-stated primary purposes of the CA/B Forum. Historically, that’s been done with the use of Extended Validation SSL/TLS certificates. For many CAs, the debate around this approach had long been settled. However, in 2019 Google led a browser initiative to deprecate the EV UI, which displayed verified organization names in the address bar of browsers like Microsoft Edge, Google Chrome and Mozilla Firefox.

Now, for all intents and purposes, the debate has split into two different questions. And not all parties seem to be having the same discussions. For the browsers, the question is whether or not TLS is the best way to present this information. Google has voiced the opinion it doesn’t want SSL/TLS, which is functionally for securing web connections, to be contingent upon properly vetting and displaying identity information. Instead it has voiced support for separate, complementary hierarchies.

A lot of resistance to that perspective stems from the fact it’s such a dramatic shift from how things have always been done. The perception being that Google has decided unilaterally that the previous approach wasn’t working and is forcing an industry-wide change. It sits on key Mozilla policy modules and its Chromium engine is the backbone of other browsers like Opera and Edge. Right now, at least amongst browsers and CAs, there isn’t a ton of consensus on whether identity should be coupled with TLS certificates or presented some other way.

And that lack of consensus is where the second conversation is occurring. Many CAs feel it would be counter-productive to reinvent the wheel and favor a more pragmatic approach that would improve validation practices and provide better authentication for websites and organizations. One suggested approach is the inclusion of Legal Entity Identifiers, while PSD2 requirements in Europe could provide another path forward. There is one very strong reason to continue including identity information with TLS certificates: reliability of delivery. By moving to another approach, for instance one that might use DNS to assert identity information, there is a non-zero chance said identity information never makes it to the end user. Including it in a TLS certificate guarantees that information is available. Provided, of course, the browsers choose to display it.

These questions will need to be answered in 2020. While there are pros and cons to each various proposed solution, there should be consensus on one thing: Identity has never been more critical on the internet and it is incumbent upon all interested parties to find a smart way to display it. The devil, of course, is in the details.

## **More and more organizations will embrace PKI as a major compliance tool**

As we mentioned earlier, with more and more regulatory requirements being codified each day, compliance is a major concern for most businesses nowadays. And as we see product offerings like client certificates and digital signing solutions exploding across the industry, it’s clear that more and more organizations are embracing PKI as a major component of their compliance strategies.

That shows no signs of stopping in 2020. With worldwide requirements centering around secure communications, encrypted data and access controls – CAs are leading the compliance charge. While the web PKI is what gets most of the public and media attention in this industry, public server certificates are truly just the tip of the proverbial iceberg when it comes to the explosion of growth from the CA industry. Private PKI hierarchies and automation solutions are both major points of emphasis heading into next year. And with new requirements centering around digital signatures and seals, as well as qualified certificates in Europe, PKI looks to become even more baked into most organizations’ digital infrastructures.

## **People that don’t understand encryption will continue threatening encryption**

There’s a raging debate occurring in both the UK and the United States regarding “responsible” encryption – that is, encryption that can be broken to provide government access. The problem is that this is a highly technical topic that requires experience and expertise for informed opinions. The average politician or political appointee just doesn’t have the time or capacity to become well-versed in something as complex as encryption. There’s no fault with that, either. Unless those same uninformed officials begin trying to make invasive policy around breaking that encryption. 2019 finished with a US Senator telling representatives from Apple and Facebook, “It ain’t complicated for me. You’re going to find a way to do this or we’re going to do it for you.” That doesn’t inspire much confidence in a technically sound solution to these supposed problems. In 2020, look for these kinds of misinformed statements and sentiments to continue. While the EU is working to codify data privacy rights for all of its citizens, other regions seem intent on going backwards by undermining encryption technology and creating burdensome requirements that will put their own companies at a competitive disadvantage. The technology world already has – and must continue to – oppose this vigorously.