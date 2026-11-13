import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { experimental_generateVideo as generateVideo, experimental_startVideo as startVideo } from 'ai';
import { createDetailX } from '@detailx/ai-sdk-provider';

const stage = process.argv[2];
assert(['start', 'finish'].includes(stage), 'Use start or finish');
const output = process.env.DETAILX_ACCEPTANCE_DIR;
assert(output, 'Set DETAILX_ACCEPTANCE_DIR to a private persistent directory');
const requestId = process.env.DETAILX_ACCEPTANCE_REQUEST_ID;
assert(requestId, 'Set one stable DETAILX_ACCEPTANCE_REQUEST_ID for both stages');
await mkdir(output, { recursive: true, mode: 0o700 });
const recordPath = join(output, 'acceptance-private.json');
const options = { resolution: '720p', fps: -1 };
const provider = createDetailX({ stateDir: join(output, 'state') });
assert.equal(provider.client.baseURL, 'https://www.detail-x.ai/api/v1', 'Acceptance requires the production DetailX API');

if (stage === 'start') {
  const source = process.env.DETAILX_ACCEPTANCE_VIDEO;
  const media = process.env.DETAILX_ACCEPTANCE_MEDIA_DIR;
  assert(source && media, 'Set DETAILX_ACCEPTANCE_VIDEO and DETAILX_ACCEPTANCE_MEDIA_DIR');
  const metadata = JSON.parse(await readFile(join(media, 'metadata.json'), 'utf8'));
  assert(metadata.duration <= 3, 'Use an owned acceptance sample no longer than three seconds');
  const thumbnail = await readFile(join(media, 'thumbnail.jpg'));
  const upload = await provider.client.uploadFile(source, { requestId: requestId + ':upload', metadata, thumbnail });
  const quote = await provider.client.estimate({ uploadId: upload.asset_id }, options);
  assert(quote.credits > 0 && quote.credits <= 10, 'Acceptance precharge must be between 1 and 10 credits');
  await assert.rejects(provider.client.prepareGeneration({ uploadId: upload.asset_id }, options, {
    requestId: requestId + ':budget-guard', maxPrechargeCredits: quote.credits - 1,
  }), error => error.code === 'budget_exceeded');
  const settings = { uploadId: upload.asset_id, requestId, maxPrechargeCredits: 10, resolution: '720p' };
  const started = await startVideo({ model: provider.video(), prompt: '', providerOptions: { detailx: settings }, maxRetries: 0 });
  await writeFile(recordPath, JSON.stringify({ settings, operation: started.operation, quotedCredits: quote.credits }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ stage, accepted: true, quotedCredits: quote.credits, budgetGuardPassed: true, operationSavedWithoutKey: true }));
} else {
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const before = await provider.client.getGeneration(record.operation.generationId);
  const result = await generateVideo({
    model: provider.video(), prompt: '', providerOptions: { detailx: record.settings },
    download: provider.download, poll: { intervalMs: 10000, timeoutMs: 1800000 }, maxRetries: 0,
  });
  assert.equal(result.videos.length, 1);
  const job = await provider.client.getGeneration(record.operation.generationId);
  const prepared = await provider.client.prepareGeneration({ uploadId: record.settings.uploadId }, options, {
    requestId, maxPrechargeCredits: 10,
  });
  const reused = await provider.client.submit(prepared);
  assert.equal(reused.id, job.id, 'A recreated client must recover the original generation');
  assert.equal(before.id, job.id);
  const ledger = await provider.client.request('GET', '/billing/transactions?limit=100');
  const transactions = ledger.items.filter(item => item.generation_id === job.id);
  assert.equal(transactions.length, 1, 'Expected one billing transaction for the recovered generation');
  const video = result.video.uint8Array;
  assert(video.byteLength > 0);
  await writeFile(join(output, 'enhanced.mp4'), video, { mode: 0o600 });
  const summary = {
    date: new Date().toISOString().slice(0, 10), status: job.status,
    quotedCredits: record.quotedCredits, prechargedCredits: job.precharged_credits,
    settledCredits: job.credits, settled: !!job.settled_at, refundStatus: job.refund_status,
    billingTransactions: transactions.length, sameGenerationAfterProcessRestart: true,
    downloadedBytes: video.byteLength, output: {
      width: job.results[0].width, height: job.results[0].height, duration: job.results[0].duration,
    },
  };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
}
