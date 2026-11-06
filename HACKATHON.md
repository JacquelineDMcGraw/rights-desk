# Rights Desk — PayPal AI Hackathon handoff

The demo story is **proof → permission → payment**: one private creator case becomes a reviewed voluntary license offer, then a PayPal Sandbox payment and a receipt recorded in that case.

## Submission date and access

The [official rules](https://paypalaihackathon.devpost.com/rules), checked November 5, 2026, set the deadline at **November 12, 2026, noon Pacific / 3 p.m. Eastern**. They require meaningful PayPal and AI use, a working build, a public open-source repository, and a public YouTube demonstration under three minutes. Judges may run the app from complete setup instructions; public hosting is optional. Maintain judge access through the end of judging, December 15, 2026.

The source includes an MIT license. The development repository is [JacquelineDMcGraw/rights-desk](https://github.com/JacquelineDMcGraw/rights-desk), kept private at Jackie's request. A private repository does not yet meet Devpost's public source requirement. YouTube upload and Devpost submission remain pending. Use [docs/DEVPOST-SUBMISSION.md](docs/DEVPOST-SUBMISSION.md) for the submission text and a 2:50 demo script.

## Current verification

On November 5, 2026 Eastern, the real local `gemma3:4b` inference check passed: “A one year national editorial article on our magazine website” produced editorial / one-year / national scope, no assumptions, and $168.75 from a $75 base rate with a 2.25 rights factor. The request returned `aiMode: "ollama"` in about 3.3 seconds. Reproduce it with `npm run verify:ai`.

Real PayPal Sandbox approval/capture remains pending because project credentials have not been configured. Mock payment regression coverage is available; it does not replace the actual Sandbox recording.

## Run the actual demonstration

1. Install Node.js 22 or newer and ImageMagick (`magick`) for local thumbnail comparison. Optional `exiftool` and `c2patool` add provenance signals in the separate Studio flow. No npm install is needed.
2. Start Ollama and install the configured model. The default is `gemma3:4b`; `OLLAMA_MODEL` can select a different installed model. Run `ollama serve` if the desktop app is not already serving, then `ollama pull gemma3:4b`.
3. In PayPal Developer, select Sandbox, create an app associated with a Sandbox business account, and use its client ID and secret in the local server environment. A separate Sandbox personal account acts as buyer. Never put credentials in source, screenshots, video, public README text, or Devpost text.
4. Prepare the local `.env` from `.env.example`. Run `npm run readiness` to check integration availability, then `npm run verify:ai` to exercise a real model draft. Launch `node --env-file=.env server.mjs`. `GET /api/status` should report `paypalConfigured:true` and `ollamaAvailable:true`. PayPal configuration means credentials exist; a real approval and verified capture are still required to prove payment works.
5. Open `http://localhost:5188/#protect`. Create a case with an original or authorized image, a clear title, work type, use channel, and U.S. location. Use synthetic case details and evidence for recording. Run the public search before recording if provider latency would consume the short video; show the real coverage report and its timestamp.
6. Add a supporting record and review the evidence checklist. Describe a specific voluntary use, for example: “One-year editorial use in a local community newsletter website, with attribution to the photographer.” Set a $25 base rate. Generate the draft and confirm its `aiMode` is `ollama`, then review or edit every scope field and the final price.
7. Approve the offer and copy its link. Open that link in another browser session to show the buyer's limited view. It includes approved offer details, without the private case image, story, reported URL, or supporting files. The prototype binds only to localhost; use browsers on the same computer for this demo.
8. As the test buyer, enter a synthetic licensee name and review the offer terms. Continue to PayPal Sandbox, approve with the Sandbox personal account, and return to Rights Desk. The server must verify the exact order, offer reference, completed capture, currency, and price before showing a receipt.
9. Return to the creator's browser, reopen the case, and show its paid offer and receipt. Download the case summary. The case offer grants the stated permission and records payment; it does not deliver private case files. Studio/Discover separately demonstrate paid source-file delivery if time permits.

## What to record

Record the narrow phone layout with readable text. Show the actual model badge, approved terms, Sandbox approval, receipt, and updated case. Keep the story focused on a single creator and a single work. Use a short original or authorized sample; avoid showing Getty marks, outside copyrighted material, real dispute details, or credentials in footage.

Do not portray an integration test as a PayPal transaction. The mock test is useful for verification, but the public video must show the real configured model and Sandbox flow. A missing result can be shown honestly; it does not imply the work is unprotected or free to use.

## Verification and final gates

- Run `npm run check` and `npm test` for syntax and the isolated offer/AI scope regression checks. The regression tests use mocked responses.
- Run `npm run readiness` and `npm run verify:ai` to check availability and actual local model inference.
- Reconfirm the actual model draft in the recording setup and complete one real Sandbox payment. The local inference check passed; real PayPal approval/capture is the remaining integration gate.
- Confirm the phone creator and buyer flows, including cancellation and an unavailable integration, remain understandable.
- Publish the source to an approved public GitHub, GitLab, or Bitbucket destination with `LICENSE`, complete run instructions, and all required source/assets. Exclude `.env`, `data/`, private evidence, and test artifacts that contain session data.
- Record and upload the under-three-minute video to an approved public YouTube destination. Update the draft with the actual repository and video URLs.
- Check the official rules again, complete Devpost fields, and submit before the deadline. Submitting accepts the rules; Jackie must review the final entry and perform any required account or agreement steps.

The [judging criteria](https://paypalaihackathon.devpost.com/rules) give equal weight to implementation, design, impact, innovation, and presentation. The strongest evidence is one coherent working path: AI helps turn plain language into explicit rights, the creator approves the offer, PayPal confirms payment, and the case retains the resulting permission record.
