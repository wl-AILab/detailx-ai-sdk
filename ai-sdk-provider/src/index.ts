import {
  NoSuchModelError,
  type ProviderV4,
  type Experimental_VideoModelV4 as VideoModel,
  type Experimental_VideoModelV4CallOptions as CallOptions,
  type Experimental_VideoModelV4File as VideoFile,
  type Experimental_VideoModelV4OperationStartResult as StartResult,
  type Experimental_VideoModelV4OperationStatusResult as StatusResult,
  type JSONValue,
} from '@ai-sdk/provider';
import { createDownload } from 'ai';
import { DetailXClient, DetailXError, type ClientOptions, type GenerationOptions, type Source, type Resolution, type Result } from '@detailx/sdk';

export type DetailXVideoDownload = (options: { url: URL; abortSignal?: AbortSignal }) => Promise<{ data: Uint8Array; mediaType: string | undefined }>;

export interface DetailXProviderOptions extends ClientOptions {
  client?: DetailXClient;
  /** Upload inputReferences via a trusted media worker; the upstream API does not accept URLs. */
  prepareMedia?: (file: VideoFile, context: { requestId: string; signal?: AbortSignal }) => Promise<Source>;
  /** Credential-free media transport. Defaults to the AI SDK downloader. */
  download?: DetailXVideoDownload;
  maxDownloadBytes?: number;
}
export interface DetailXVideoSettings {
  uploadId?: string;
  sourceResultId?: string;
  requestId: string;
  maxPrechargeCredits: number;
  resolution?: Resolution;
  detail?: '1' | '2' | '3';
  lightCorrect?: boolean;
  flowSmooth?: boolean;
  keepColor?: boolean;
  trajectorySmooth?: boolean;
}

export class DetailXVideoModel implements VideoModel {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'detailx.video';
  // Preserve the caller's n so doStart can reject batches before SDK fan-out.
  readonly maxVideosPerCall = Number.MAX_SAFE_INTEGER;
  readonly modelId = 'video-upscale';
  constructor(private client: DetailXClient, private prepareMedia?: DetailXProviderOptions['prepareMedia'], private rememberResult?: (generationId: string, result: Result) => void) {}

  async doStart(options: CallOptions & { webhookUrl?: string }): Promise<StartResult> {
    if (options.n !== 1 || options.seed !== undefined || options.duration !== undefined || options.image || options.frameImages?.length || options.generateAudio !== undefined || options.prompt?.trim() || options.webhookUrl || (options.aspectRatio && options.aspectRatio !== 'adaptive')) {
      throw new DetailXError('DetailX supports one source-video enhancement per request. Prompt, seed, duration, image generation, audio synthesis, aspect-ratio changes and webhooks are unsupported.', 'unsupported_options');
    }
    const raw = options.providerOptions?.detailx;
    if (!raw || typeof raw !== 'object') throw new DetailXError('providerOptions.detailx is required', 'missing_options');
    const settings = raw as unknown as DetailXVideoSettings;
    const allowed = new Set(['uploadId','sourceResultId','requestId','maxPrechargeCredits','resolution','detail','lightCorrect','flowSmooth','keepColor','trajectorySmooth']);
    if (Object.keys(raw).some(k=>!allowed.has(k))) throw new DetailXError('Unknown detailx provider option', 'invalid_options');
    if (typeof settings.requestId !== 'string' || !settings.requestId) throw new DetailXError('A stable business requestId is required', 'missing_request_id');
    let source: Source;
    const references = options.inputReferences ?? [];
    if (references.length) {
      if (references.length !== 1 || settings.uploadId || settings.sourceResultId || !this.prepareMedia) throw new DetailXError('One video reference requires prepareMedia; do not mix source IDs and references', 'invalid_source');
      if (!references[0].mediaType?.startsWith('video/')) throw new DetailXError('Reference must be a video', 'invalid_source');
      source = await this.prepareMedia(references[0], { requestId: settings.requestId + ':upload', signal: options.abortSignal });
    } else {
      source = { uploadId: settings.uploadId, sourceResultId: settings.sourceResultId } as Source;
    }
    const resolutions: Record<string, Resolution> = { '1280x720': '720p', '720x1280': '720p', '1920x1080': '1080p', '1080x1920': '1080p', '2560x1440': '2K', '1440x2560': '2K', '3840x2160': '4K', '2160x3840': '4K' };
    const standardResolution = options.resolution ? resolutions[options.resolution] : undefined;
    if (options.resolution && !standardResolution) throw new DetailXError('Use providerOptions.detailx.resolution for a supported resolution tier', 'invalid_options');
    if (settings.resolution && standardResolution && settings.resolution !== standardResolution) throw new DetailXError('Conflicting resolution settings', 'invalid_options');
    const parameters: GenerationOptions = {
      resolution: settings.resolution ?? standardResolution ?? '4K', fps: (options.fps ?? -1) as GenerationOptions['fps'],
      detail: settings.detail, light_correct: settings.lightCorrect, flow_smooth: settings.flowSmooth,
      keep_color: settings.keepColor, trajectory_smooth: settings.trajectorySmooth,
    };
    const prepared = await this.client.prepareGeneration(source, parameters, { requestId: settings.requestId, maxPrechargeCredits: settings.maxPrechargeCredits, signal: options.abortSignal });
    const job = await this.client.submit(prepared, options.abortSignal);
    return {
      operation: { generationId: job.id, scope: this.client.scope }, warnings: [],
      providerMetadata: { detailx: { generationId: job.id, estimatedCredits: prepared.quote.credits } },
      response: { timestamp: new Date(), modelId: this.modelId, headers: undefined },
    };
  }

  async doStatus(options: { operation: JSONValue; abortSignal?: AbortSignal }): Promise<StatusResult> {
    const operation = options.operation as { generationId?: string; scope?: string } | null;
    if (!operation || operation.scope !== this.client.scope || typeof operation.generationId !== 'string') throw new DetailXError('Operation belongs to another credential or is malformed', 'invalid_operation');
    const job = await this.client.getGeneration(operation.generationId, options.abortSignal);
    const response = { timestamp: new Date(), modelId: this.modelId, headers: undefined };
    const providerMetadata = { detailx: { generationId: job.id, status: job.status, credits: job.credits ?? null, refundStatus: job.refund_status ?? null, progress: job.progress ?? null } };
    if (job.status === 'failed') return { status: 'error', error: 'DetailX generation failed; refund state: ' + (job.refund_status ?? 'unknown'), response, providerMetadata };
    if (job.status !== 'completed') return { status: 'pending', response, providerMetadata };
    const media = job.results?.[0];
    const url = media?.url || media?.fallback_url;
    if (!url) return { status: 'error', error: 'Result media is unavailable or expired', response, providerMetadata };
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new DetailXError('Result URL must use HTTPS without embedded credentials', 'unsafe_url');
    this.rememberResult?.(job.id, media);
    return { status: 'completed', videos: [{ type: 'url', url, mediaType: 'video/mp4' }], warnings: [], response,
      providerMetadata: { detailx: { ...providerMetadata.detailx, resultId: media.id, width: media.width, height: media.height, duration: media.duration, expiresAt: media.expires_at ?? null, urlExpiresAt: media.url_expires_at ?? null, fallbackUrl: media.fallback_url ?? null, fallbackUrlExpiresAt: media.fallback_url_expires_at ?? null } } };
  }
}

export interface DetailXProvider extends ProviderV4 {
  video(modelId?: 'video-upscale'): DetailXVideoModel;
  videoModel(modelId: string): DetailXVideoModel;
  readonly client: DetailXClient;
  readonly download: DetailXVideoDownload;
}
export function createDetailX(options: DetailXProviderOptions = {}): DetailXProvider {
  const client = options.client ?? new DetailXClient(options);
  if (options.maxDownloadBytes !== undefined && (!Number.isSafeInteger(options.maxDownloadBytes) || options.maxDownloadBytes <= 0)) throw new DetailXError('maxDownloadBytes must be a positive integer', 'invalid_options');
  const download = options.download ?? createDownload({ maxBytes: options.maxDownloadBytes });
  const sources = new Map<string, { generationId: string; result: Result }>();
  const rememberResult = (generationId: string, result: Result) => {
    const url = result.url || result.fallback_url;
    if (!url) return;
    const key = new URL(url).href;
    sources.delete(key);
    sources.set(key, { generationId, result });
    // Bound retained URLs for providers shared by long-lived application servers.
    if (sources.size > 256) sources.delete(sources.keys().next().value!);
  };
  const downloadWithFallback: DetailXVideoDownload = async args => {
    const source = sources.get(args.url.href);
    try {
      return await download(args);
    } catch (error) {
      args.abortSignal?.throwIfAborted();
      if (!source) throw error;
      let media = source.result;
      try {
        const refreshed = await client.getGeneration(source.generationId, args.abortSignal);
        media = refreshed.results?.find(result => result.id === source.result.id) ?? media;
      } catch {
        args.abortSignal?.throwIfAborted();
      }
      for (const candidate of new Set([media.url, media.fallback_url, source.result.fallback_url])) {
        if (!candidate || candidate === args.url.href) continue;
        const url = new URL(candidate);
        if (url.protocol !== 'https:' || url.username || url.password) continue;
        try { return await download({ ...args, url }); }
        catch (fallbackError) { args.abortSignal?.throwIfAborted(); error = fallbackError; }
      }
      throw error;
    } finally {
      sources.delete(args.url.href);
    }
  };
  const video = (modelId = 'video-upscale') => {
    if (modelId !== 'video-upscale') throw new NoSuchModelError({ modelId, modelType: 'videoModel' });
    return new DetailXVideoModel(client, options.prepareMedia, rememberResult);
  };
  return {
    specificationVersion: 'v4', client, video, videoModel: video, download: downloadWithFallback,
    languageModel: modelId => { throw new NoSuchModelError({ modelId, modelType: 'languageModel' }); },
    embeddingModel: modelId => { throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' }); },
    imageModel: modelId => { throw new NoSuchModelError({ modelId, modelType: 'imageModel' }); },
  };
}
