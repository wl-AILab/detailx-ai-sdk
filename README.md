# DetailX for AI SDK

Video super-resolution and optional frame interpolation through the [DetailX API](https://www.detail-x.ai).

| Package | Purpose |
| --- | --- |
| [`@detailx/ai-sdk-provider`](ai-sdk-provider) | AI SDK 7 video provider with asynchronous start/status, quoted budgets and recoverable downloads |
| [`@detailx/sdk`](sdk-typescript) | Node.js client with multipart uploads, durable job submission and optional PostgreSQL storage |

```bash
npm install @detailx/ai-sdk-provider ai
```

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
    },
  },
  download: detailx.download,
  poll: { intervalMs: 10000, timeoutMs: 1800000 },
});
```

Set `DETAILX_API_KEY` on the server. This provider enhances an existing owned video; text-to-video and image-to-video are unsupported. Precharge budgets do not cap possible final settlement adjustments.

Read the [provider documentation](ai-sdk-provider/README.md) for uploads, persistent storage, long-running jobs and capability limits. See [real-service verification](ai-sdk-provider/VERIFICATION.md) for the exact tested behavior and scope.

## Development

Requires Node.js 20.3 or later; CI runs on Node.js 22 and 24.

```bash
npm ci
npm run build
npm run check
npm test
```

No API key is needed for the automated tests. Real-service acceptance is opt-in and billable; see [the acceptance script](ai-sdk-provider/scripts/acceptance.mjs). Credentials, request state, signed media URLs and customer media must stay outside the repository.

## Support

Report integration bugs through [GitHub Issues](https://github.com/wl-AILab/detailx-ai-sdk/issues). Obtain API keys and manage account billing at [DetailX](https://www.detail-x.ai/integrations/api).

MIT license.
