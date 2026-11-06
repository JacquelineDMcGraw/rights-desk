# Rights Desk — hackathon pitch

## The opening

On **October 21, 2026**, Getty Images Holdings and several U.S. subsidiaries filed voluntary petitions for a **prepackaged Chapter 11 reorganization**. Getty says the process is intended to reduce debt and address non-operating liabilities while its business and contributor payments continue. The filing is a timely signal that the visual-licensing market is changing; it is **not evidence that generative AI caused Getty's bankruptcy**.[1][2]

The underlying creator problem is clear in Getty's own filings. Its 2025 annual report describes unauthorized use of copyrighted work for AI training and AI images that can substitute for licensed photography as business risks. Getty reported paying more than **$220 million in royalties to contributors in 2025**, underscoring how many livelihoods depend on workable licensing. Its Creative revenue declined **3.6% year over year in the first half of 2026**, though Getty did not attribute that decline to AI.[3][4]

## One-line pitch

**Rights Desk takes U.S. creators from proof to permission to payment: preserve the work, gather rights evidence, approve a clear license offer, and connect its PayPal payment receipt to the case.**

## What the product does

1. **Open a private case.** A creator uploads a reference image or screenshot and records the medium, possible use, location, and facts. Rights Desk records a file hash to identify the exact reference. A spotlight tutorial walks through the first case and evidence collection. In the separate Studio flow, optional metadata and Content Credentials checks add origin signals; none of these checks certifies human authorship.
2. **Find candidate matches.** The prototype searches Openverse, Wikimedia Commons, and the Library of Congress by title and short scene terms, then compares the uploaded image locally with a small sample of returned thumbnails. Each result links to its source record and displays available creator and license metadata. Coverage and unavailable sources are shown in the report. Copyright Office records and authorized image-search services are future integrations, not sources currently queried by the app.
3. **Fill evidence gaps.** If there is no result, or a result conflicts with the creator's account, Rights Desk asks for the relevant originals, drafts, contracts, registration details, publication history, or correspondence. The checklist changes with the medium. A missed match never becomes a “free to use” or “you own it” verdict.
4. **Guide the next step.** The U.S. flow asks for the creator's state, D.C., or territory and the medium, then points to the applicable federal copyright basics, relevant local resources, and practical choices: document, register, seek a license, request attribution or removal, or consult qualified counsel. It presents information and evidence for a person to review; it does not decide infringement or promise a legal outcome.
5. **Draft permission for review.** From the case, the creator describes a proposed voluntary licensed use and base rate. A local model classifies scope into usage, duration, and territory, while fixed factors suggest a price. Assumptions stay visible. The creator reviews and approves the exact scope and price before creating a buyer link.
6. **Connect permission to payment.** The buyer sees only the approved offer, reviews its terms, and can pay through PayPal Sandbox. The server verifies the capture against the exact offer reference, currency, and price before issuing a receipt in the case. The receipt identifies the work fingerprint, names, scope, amount, capture, and time. Case evidence stays private. A case offer records permission; Studio/Discover separately support delivery of a licensed source file after payment.

## Demo path

Open a private creator case → run a source-attributed search → review a visual lead or an honest no-result report → add relevant evidence → describe a proposed use → review the actual model's scope draft and the price → approve a voluntary offer → open its buyer link → complete PayPal Sandbox approval → show the verified receipt in the same case.

This is the recording target. Real local `gemma3:4b` scope inference passed on November 5, 2026 Eastern; reproduce it with `npm run verify:ai`. Real Sandbox approval/capture remains pending and must be recorded before claiming the complete payment demonstration. Mock integration tests verify application behavior, not a real payment.

## Why this fits the hackathon

The creator's task gives PayPal a central role: a documented work becomes an explicit permission offer with a payment record. AI reduces the effort of converting a plain-language use into reviewable scope; a person controls the terms. The phone interface and first-case tutorial make that sequence understandable without a rights-management background. The strongest demo proves one complete case through to its receipt.

The [official judging rules](https://paypalaihackathon.devpost.com/rules), checked November 5, 2026, evaluate implementation, design, impact, innovation, and presentation equally. This is a product argument to demonstrate, not a prediction of a prize. See [the submission packet](docs/DEVPOST-SUBMISSION.md) for the concrete pitch and recording plan.

## The honest coverage promise

There is **no single public database of every licensed work or private license**. The Copyright Office's public system contains registration and recordation metadata, not a complete reverse-image corpus, and the Office warns that searchable records can contain gaps and inaccurate applicant-provided information.[5] Openverse indexes openly licensed and public-domain media, not all commercial catalogs; its API is text/metadata search with rate and pagination limits.[6] The Library of Congress and Smithsonian APIs cover their own collections, not the whole market.[7][8] Visual web-match services cover only their indexes: TinEye explicitly says a no-result search means no match *in its index*, not no match on the internet.[9] Commercial catalogs require their own API access and terms; Shutterstock, for example, requires authentication and limits search to the media library allowed by the application's subscription.[10]

Rights Desk should therefore display **“sources searched,” “sources unavailable,” “candidate match,” and “no match found in searched sources”** for every report. A visual match is a lead to review against chain of title and licenses, not proof of ownership, unauthorized use, or AI training.

The prototype uses anonymous browser sessions and self-entered names. It does not verify ownership or buyer identity, contact suspected users, file notices, determine infringement, or settle prior claims. A voluntary offer covers its stated use; the configured Sandbox merchant receives test payments. Production creator payouts, accounts, backup, legal review, and payment webhooks are future work.

## Sources

1. [Getty Images Holdings, Form 8-K, Item 1.03, filed October 21, 2026](https://www.sec.gov/Archives/edgar/data/1898496/000121390026111193/ea0309225-8k_getty.htm).
2. [Getty Images, restructuring announcement, October 21, 2026, filed as SEC exhibit](https://www.sec.gov/Archives/edgar/data/1898496/000121390026111193/ea030922501ex99-2.htm).
3. [Getty Images Holdings, 2025 Form 10-K, AI risk factors and contributor royalties](https://www.sec.gov/Archives/edgar/data/1898496/000162828026018160/gety-20251231.htm).
4. [Getty Images Holdings, second-quarter 2026 Form 10-Q, Creative revenue](https://www.sec.gov/Archives/edgar/data/1898496/000162828026055246/gety-20260630.htm).
5. [U.S. Copyright Office, Copyright Public Records System and its search disclaimer](https://publicrecords.copyright.gov/search?query=VA1310583); [Copyright Office account of CPRS coverage](https://www.copyright.gov/newsnet/2025/1071.html).
6. [Openverse API documentation](https://api.openverse.org/v1/).
7. [Library of Congress, photo collection search API and limits](https://www.loc.gov/apis/json-and-yaml/requests/endpoints/).
8. [Smithsonian Open Access API and rights FAQ](https://www.si.edu/openaccess/faq).
9. [TinEye reverse-search tutorial, including what no result means](https://help.tineye.com/article/265-tineye-tutorial).
10. [Shutterstock API reference, authentication and library access](https://api-reference.shutterstock.com/?language=en).
