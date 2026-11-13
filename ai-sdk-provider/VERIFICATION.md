# Release Acceptance: 0.1.0

Verified on 2026-11-13 with Node.js 22.23.1, AI SDK 7.0.169 and `@ai-sdk/provider` 4.0.37. Requests used the production DetailX API and an existing account's API key. Credentials, account balances, task IDs, signed media URLs and private runtime state are excluded from the repository and npm packages.

## Real Service and Installed Packages

- Reused an original two-second H.264/AAC acceptance pattern: 640 x 360, 24 fps, mono audio. No customer video was used.
- Prepared decoded metadata and the first-frame JPEG with PyAV, then uploaded through the Node.js multipart client.
- Received a quote of 2 credits for 720p with source frame rate preserved. An insufficient precharge budget was rejected before submission.
- Started one paid task through `experimental_startVideo`, then ended the process after saving the operation and durable request state.
- Installed both generated npm tarballs and AI SDK 7.0.169 into an independent project. A new process called `experimental_generateVideo` with the same business request ID and recovered the original generation.
- After publishing, installed `@detailx/sdk@0.1.0` and `@detailx/ai-sdk-provider@0.1.0` directly from the npm registry in another independent project. Both registry package integrity values match the verified release tarballs. Main exports, the optional PostgreSQL export and AI SDK video entry points import successfully.
- Repeated the recovery and download with the registry-installed packages. It returned the same generation and 1,432,552-byte MP4, with one billing transaction still settled at 2 credits; no additional generation was created.
- Downloaded a 1,432,552-byte MP4 through `download: detailx.download`. Repeated submission of the persisted prepared request returned the same generation.
- The corresponding generation had one billing transaction. Precharge and final settlement were both 2 credits.
- Decoded the result with PyAV: 1280 x 720, 24 fps, 48 video frames, 2.0 seconds, one audio stream and 96,256 decoded audio samples including AAC padding. The first frame was nonblank.

The production API reported null width and height for this result. Output dimensions above come from decoding the MP4, and the SDK's response types permit nullable media dimensions.

## Automated Checks

The two workspace packages compile and pass type checks. Eight tests cover AI SDK start/status orchestration, immutable request recovery after a lost response, budget and price-revision guards, invalid parameters, rejection of `n > 1` before network access, backup download routing and abort behavior.

Both npm tarballs were installed independently, and the optional PostgreSQL export was imported with `pg` installed. The distribution contains compiled ESM, type declarations, documentation, licenses and the provider's public example, without credentials or runtime state.

## Limits

This acceptance verifies one short-video integration and normal settlement, not every resolution, frame rate, long-video workload, visual-quality benchmark, failure/refund scenario or operating system. Refund, price-change and transport-failure guards have mocked coverage. The PostgreSQL store has compile/import coverage; live database concurrency and recovery are not claimed.

The precharge budget does not cap final settlement adjustments. Local abort or timeout does not cancel a remote task. AI SDK community documentation remains subject to upstream maintainer review.
