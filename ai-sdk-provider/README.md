# DetailX Provider for AI SDK

[DetailX](https://www.detail-x.ai) enhances existing videos with super-resolution and optional frame interpolation. This community provider implements the experimental AI SDK 7 V4 video start/status interface. It does not generate videos from text or images.

## Install

```bash
npm install @detailx/ai-sdk-provider ai
```

Requires Node.js 20.3 or later and AI SDK 7.0.169 or later in the 7.x series. The verified versions are `ai@7.0.169` and `@ai-sdk/provider@4.0.37`. Set `DETAILX_API_KEY` on your server; obtain a key from the [DetailX developer dashboard](https://www.detail-x.ai/integrations/api).

## Enhance an Uploaded Video

```ts
import { experimental_generateVideo as generateVideo } from 'ai';
import { createDetailX } from '@detailx/ai-sdk-provider';

const detailx = createDetailX({ stateDir: '/persistent/detailx' });
const result = await generateVideo({
  model: detailx.video('video-upscale'),
  prompt: '',
  providerOptions: {
    detailx: {
      uploadId: 'OWNED_ASSET_ID',
      requestId: 'order-100',
      maxPrechargeCredits: 100,
      resolution: '4K',
      detail: '2',
    },
  },
  download: detailx.download,
  poll: { intervalMs: 10000, timeoutMs: 1800000 },
});

console.log(result.video.mediaType);
```

`requestId` must remain stable when retrying the same business operation. A different operation needs a new ID. Only `n: 1` is supported; leave `maxVideosPerCall` unset. The provider rejects batch requests before quoting or submission.

Use `download: detailx.download` to refresh result URLs and try backup media after a primary download failure. This wraps AI SDK's size-limited downloader and does not send the API key to media hosts. `maxDownloadBytes` can be set when creating the provider. `generateVideo` downloads the entire video into memory, so use the asynchronous API for large results.

## Sources and Settings

Specify exactly one of `uploadId` or `sourceResultId`. A result ID comes from a generation's `results[].id`; it is not the generation ID.

| Setting | Supported values |
| --- | --- |
| `resolution` in `providerOptions.detailx` | `720p`, `1080p`, `2K`, `4K` |
| Standard `fps` | Omitted to preserve the source rate; `24`, `30`, `60` |
| `detail` | String `1`, `2`, `3` |
| Optional switches | `lightCorrect`, `flowSmooth`, `keepColor`, `trajectorySmooth` |

The standard `resolution` option maps common landscape or portrait dimensions to a DetailX tier; it does not crop to an exact size. The source aspect ratio is preserved. Prompts must be empty. Text/image generation, seed, duration changes, audio synthesis, aspect-ratio changes and native webhooks are unsupported.

## Uploads

The API accepts owned source IDs rather than arbitrary video URLs. Upload local files using `detailx.client.uploadFile()` from [the DetailX SDK](https://github.com/wl-AILab/detailx-ai-sdk/tree/main/sdk-typescript), supplying decoded metadata and the actual first-frame JPEG. The SDK implements multipart upload and recovery, and does not bundle FFmpeg.

Video `inputReferences` require a trusted `prepareMedia(file, { requestId, signal })` hook supplied to `createDetailX`. Your media worker must download, decode and upload the video, returning `{ uploadId }`. Without the hook, references are rejected.

## Long-Running Jobs

Use `experimental_startVideo` and `experimental_getVideoStatus` from `ai` to start and query jobs across separate requests. Their operation reference contains a generation ID and credential scope, never the API key. Alternatively, use `detailx.client.prepareGeneration()`, `submit()` and `getGeneration()` for ID/URL-based delivery without downloading the video into memory.

The default file store requires a persistent volume. On Vercel Functions, inject a transactional `RequestStore`, such as `PostgresRequestStore` from `@detailx/sdk/postgres`, or use a separate persistent job service. See [the PostgreSQL example](examples/persistent-task.mjs). Local abort or polling timeout only stops waiting; the remote job continues.

## Billing and Ownership

Authorize each user's source and budget in the host application before calling this provider. `maxPrechargeCredits` limits the quoted precharge, not later settlement adjustments based on actual duration. The provider persists the quote, price revision and idempotency key before submission. A price change requires renewed authorization.

Do not expose service keys in browser code. Result URLs expire; query the generation to refresh them. Videos are processed by DetailX under the account's service and media-retention policies.

## Development

From the repository root:

```bash
npm ci
npm run build
npm run check
npm test
```

[Source and issues](https://github.com/wl-AILab/detailx-ai-sdk) | [Release verification](https://github.com/wl-AILab/detailx-ai-sdk/blob/main/ai-sdk-provider/VERIFICATION.md) | [Changelog](CHANGELOG.md)
