# Rights Desk — Devpost submission draft

Updated November 12, 2026. Paste the project name, tagline, and description into Devpost. Fill the public links after verifying access. The [repo walkthrough](WALKTHROUGH.md) contains the recorded iPhone launch, app screenshots, and a separate verified PayPal Sandbox checkout clip.

## Project name

Rights Desk

## Tagline

Know what’s changing before you agree. Get paid for the use you approve.

## Description

### Inspiration

A photographer lets a local diner use Harbor at Dawn Photo on its printed menus. Later, the diner wants to use the photo in a paid online commercial. The photographer has to find the original agreement, work out what the diner is asking to change, and decide what to allow and charge.

We built Rights Desk to help independent creators make that decision and keep the resulting permission and payment together.

### What it does

Rights Desk puts the existing permission and the new request side by side. Local AI compares the purpose, where the work will appear, how long the permission lasts, and the territory it covers. Creators can inspect the passages behind each finding, answer missing details one at a time, and save a draft while they check with the buyer.

In the Harbor Diner example, the photographer decides to allow one 30-second paid online commercial in the United States for 90 days from payment, with photo credit and a $75 fee. The creator checks those terms in the buyer preview and chooses whether to share an offer. The buyer accepts that version of the terms before PayPal Sandbox checkout, and a verified payment creates a receipt for the exact use accepted.

The iPhone app opens to My desk and includes offline IP Notes for importing a memo, transcribing it on the phone, and saving the edited text alongside the audio. The legal help panel also lets creators and buyers look up nearby law offices by ZIP code and find bar directories and copyright clinic resources.

### How we built it

The mobile interface uses HTML, CSS, and JavaScript with a Node.js server. Gemma 3 runs locally through Ollama. The server checks each model quotation against the submitted text and leaves unsupported details open for the creator to review.

The offer records a fixed copy of the approved work, scope, fee, and conditions. The buyer accepts a fingerprint for that exact version. PayPal Orders v2 handles Sandbox checkout. The server checks the completed capture against the order, offer reference, currency, and amount before issuing a receipt.

The iPhone app uses Swift and WebKit to open My desk and an isolated IP Notes workspace. Apple’s on-device speech model handles transcription on compatible iPhones. The ZIP search combines postal location data with nearby OpenStreetMap listings and provides lawyer referral resources.

### Challenges we ran into

“30-second commercial” describes the length of the video and leaves the campaign duration open. We had to keep those details separate and show the passages behind the comparison so the creator could spot the difference.

We also had to keep later edits from changing what the buyer accepted. The creator can run a fresh comparison while the offer, payment, and receipt continue to point to the same approved terms.

### Accomplishments that we're proud of

The diner walkthrough shows the local AI comparison, the duration and territory questions, and the photographer’s $75 buyer preview.

We also completed a separate **$25 PayPal Sandbox payment** for a fictional paid Instagram offer. Rights Desk verified the capture and saved a receipt with the exact accepted scope, fee, and terms fingerprint. The recorded $25 checkout demonstrates the payment flow. The Harbor Diner offer is shown at preview.

### What we learned

A useful comparison needs to show why it flagged a change and what question the creator should ask next. Giving the creator room to pause, verify the source, and review the buyer preview makes the final decision easier to explain to both parties.

### What's next for Rights Desk

We want to test this with independent creators using their own agreements and follow-up messages. We’ll look at whether they can identify what changed, ask the right questions, and share clear terms. Accounts, draft recovery across devices, and production seller payment routing would support real transactions.

## Built with

Node.js 22, JavaScript, HTML, CSS, Swift, WebKit, Apple SpeechAnalyzer, Ollama, Gemma 3, PayPal Sandbox REST OAuth, PayPal Orders v2, and OpenStreetMap.

## Links to complete

| Field | Value |
| --- | --- |
| Development repository | [JacquelineDMcGraw/rights-desk](https://github.com/JacquelineDMcGraw/rights-desk). Public access is pending. |
| Demo access | [Quickstart](../README.md#judge-quickstart-from-a-clean-checkout) and [illustrated walkthrough](WALKTHROUGH.md). |
| Public YouTube video | Final review, narration, and public upload are pending. |
| License | [MIT](../LICENSE). |

## 2:50 phone demo script

Aim for a cut under three minutes. Use the [walkthrough](WALKTHROUGH.md) for the exact example text, inputs, and recorded media.

| Time | Show | Voiceover |
| --- | --- | --- |
| 0:00–0:33 | iPhone icon opens My desk, then the photo and diner story | “Harbor Diner can use my photo in its printed menus. Now it wants to use the same photo in a commercial.” |
| 0:33–0:58 | Fresh review, existing permission, and proposed use | “I save the original permission and add the new request. Rights Desk keeps both records in my case.” |
| 0:58–1:19 | AI comparison and clarification | “The comparison shows me the exact wording. I enter 90 days from payment and United States only.” |
| 1:19–1:38 | Creator terms and $75 buyer preview | “I require photo credit and preview a $75 offer for one 30-second commercial.” |
| 1:38–1:53 | Recorded $25 Sandbox checkout and receipt | “This separate $25 Sandbox test shows the accepted terms carried through to a verified receipt.” |
| 1:53–2:15 | Creator context and legal help | “When I need advice, I can look up nearby law offices or find a referral and ask about copyright or licensing.” |
| 2:15–2:50 | IP Notes and closing | “On iPhone, I can import a memo, transcribe it on the device, and save it with the audio.” |

Review the finished video for runtime, scope labels, and any private information before uploading.

## Final entry review

- [x] Actual local AI comparison and separate completed $25 Sandbox payment verified.
- [x] Illustrated repo walkthrough and recorded app and payment clips prepared.
- [ ] Final video reviewed, under three minutes, and uploaded publicly.
- [ ] Repository URL accessible to judges and setup steps confirmed from a clean checkout.
- [ ] Jackie reviews and submits the final entry.

[PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules)
