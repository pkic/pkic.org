---
authors:
- Dean Coclin
- Tim Hollebeek
date: "2017-08-30T20:14:03+00:00"
dsq_thread_id:
- 6108064630
keywords:
- https
- quantum
- encryption
- rsa
- pki
- qubit
- ssl
- web pki
tags:
- SSL/TLS
- Quantum
- Encryption
- RSA
- PKI
- Web PKI
title: 'Quantum Computing: Real or Exaggerated Threat to the Web PKI?'


---
Twenty years ago, paying your phone or electric bill involved receiving it in the mail, writing a check and mailing it back to the company. Today, that has largely been replaced by email and web-based payment submittals. All of this is secured by digital certificates and encryption, which provide privacy and authentication of information transiting the open Internet (aka Web PKI).

The web PKI is predominantly secured by RSA encryption algorithms; mathematical theorems which have been improved over time. These algorithms depend on the difficulty of computers in factoring large prime numbers in a reasonable time. The current state of binary computers would require 6.4 quadrillion (See: [https://www.digicert.com/TimeTravel/math.htm][1]) years to solve this mathematical problem and subsequently decrypt a message.

Quantum computers however could theoretically solve this problem much faster; it depends how big and fast your quantum computer is and it’s hard to get a reliable estimate since only trivially small ones exist right now. If ever realized, this would have a HUGE impact on the current web PKI which is depended upon by global e-commerce. Computers today are described as knowing two states: zero/one or on/off. These states are why at the lowest level, all programming resolves into binary code. Quantum computers on the other hand, can represent data using qubits.

Qubits are two-level quantum systems that can be manipulated into complex intermediate states, including states where the state of one qubit may depend on the states of one or more other qubits in complicated ways.  The idea that this could be used to perform computations that classical computers could not perform was suggested by Richard Feynman in 1982.  In 1994, Peter Shor gave an explicit algorithm for factoring numbers using a quantum computer, so how to factor numbers on a quantum computer has been known for a long time.

While Shor’s algorithm is based only on the quantum behavior of two-level systems, which have been understood for almost 100 years, implementing it in practice is a huge challenge.  For the large products of primes relevant to RSA, thousands of interacting qubits must be manipulated through a sequence of quantum states very precisely, and any premature interaction with the external environment with any qubit will cause its state to collapse.  Error correction methods exist to solve some of these problems, but at the cost of requiring even more qubits.  To date, this has generally restricted demonstrations of Shor’s algorithm to numbers that are of more interest to math students in grade school, rather than cryptographers.

Still, progress is being made, and there are a huge number of potential two-level quantum systems that could be used to construct a quantum computer.  It seems likely that sooner or later, someone will figure out how to efficiently construct a large number of qubits that are appropriately isolated and can be interacted with in the required manner.  If those problems can be overcome, there is little doubt that it would function correctly.  Toy systems have already demonstrated that the algorithm can be made to work in the real world.

For now, the web PKI is safe from Quantum computing. Is the threat real? We believe it is and several large companies are working to build proof-of-concept quantum computers that could revolutionize drug discovery, optimize car routes, or even assist with artificial intelligence. But the timing for a direct web threat is quite a few years away. Nevertheless, governments and industry have started reviewing ideas for “quantum-proof” algorithms that would be resistant to any foreseeable quantum computer threats.

The idea is that it will take time to propose algorithms, select the best ones, and get them implemented and deployed into all the systems that use RSA.  Transitioning to a new set of fundamental cryptographic algorithms is a problem that may prove to be as difficult, or more difficult, than building a quantum computer, and it is best that the industry begins thinking about the problem now so that solutions are available by the time large-scale quantum computers arrive.

Could nation states have already built quantum computers that solve the issues with the delicate nature of qubits? This is a good question and one that no one knows the answer to. However, given the current state of research in this area, it is unlikely that anyone has made such a _quantum_ leap. So continue to pay your bills online, securely shop and whatever else you do when you see that lock in your browser. Remember sites use different types of certificates to secure their sites and those are described in our other blog [here][2].

 [1]: https://clicktime.symantec.com/a/1/TP4yZcdQW9gewBItJK_lgR8cAeaYn1sjeg-OPz3013I=?d=9FvaWypmJdBValJZWMJMkKrPmgYlZ7wS2mW_GmhzMhPBOfaKCMC_Yg7IIrSwQGJqviJSQmP0qd0OSPVJFgs_tUD5DGp2fYSwyuXxfFVUY0bi0cSyZUjvygH2j5UESXM1Cem9M6iriBfUgwzhm_wruHD77sicSww0szVJV-2T4tMEOxfhvKPeQ8K4OzKnpTWU5qM1K3JVmQ7mh9O2Ty7tskt-bBqi8LKldHthM2YX4G1kOLOF4akDnrOIna_86-kXs2nr17IMYvGeevaNn5TfniuakEGmTB7qsZ35qbURzhTeTPh2hwr6J4tM5WeqkRCn26vZMCPnTAk-8SrJo8_SIVeW74EuloQ3_Ew_qR61mb_YCLX78K6H08SV5P7KfNmYeMbsGeHwkkdN7Syt0j2L-1AL6PVjf4lFVqVicV0amOk%3D&u=https%3A%2F%2Fscanmail.trustwave.com%2F%3Fc%3D4062%26amp%3Bd%3D7Y-g2dltHLtKB9isUn1bu_QUPHtVEG-aEnQm5Vke5A%26amp%3Bs%3D5%26amp%3Bu%3Dhttps%253a%252f%252fwww%252edigicert%252ecom%252fTimeTravel%252fmath%252ehtm
 [2]: https://clicktime.symantec.com/a/1/3rv_iioujUyUxGNvFHSJ3DpquTUv1XNnnb2pT5pmv0c=?d=9FvaWypmJdBValJZWMJMkKrPmgYlZ7wS2mW_GmhzMhPBOfaKCMC_Yg7IIrSwQGJqviJSQmP0qd0OSPVJFgs_tUD5DGp2fYSwyuXxfFVUY0bi0cSyZUjvygH2j5UESXM1Cem9M6iriBfUgwzhm_wruHD77sicSww0szVJV-2T4tMEOxfhvKPeQ8K4OzKnpTWU5qM1K3JVmQ7mh9O2Ty7tskt-bBqi8LKldHthM2YX4G1kOLOF4akDnrOIna_86-kXs2nr17IMYvGeevaNn5TfniuakEGmTB7qsZ35qbURzhTeTPh2hwr6J4tM5WeqkRCn26vZMCPnTAk-8SrJo8_SIVeW74EuloQ3_Ew_qR61mb_YCLX78K6H08SV5P7KfNmYeMbsGeHwkkdN7Syt0j2L-1AL6PVjf4lFVqVicV0amOk%3D&u=https%3A%2F%2Fcasecurity.org%2F2013%2F08%2F07%2Fwhat-are-the-different-types-of-ssl-certificates%2F