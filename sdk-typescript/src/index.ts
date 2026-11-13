import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, link, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type Resolution = '720p' | '1080p' | '2K' | '4K';
export interface GenerationOptions {
  resolution?: Resolution;
  fps?: -1 | 24 | 30 | 60;
  detail?: '1' | '2' | '3';
  light_correct?: boolean;
  flow_smooth?: boolean;
  keep_color?: boolean;
  trajectory_smooth?: boolean;
}
export type Source = { uploadId: string; sourceResultId?: never } | { sourceResultId: string; uploadId?: never };
export interface Quote { model: string; credits: number; duration: number; pricing_revision_id: number }
export interface Result {
  id: string; url?: string | null; fallback_url?: string | null;
  url_expires_at?: string | null; fallback_url_expires_at?: string | null;
  width: number | null; height: number | null; duration: number | null; size_bytes?: number | null;
  expires_at?: string | null; media_status?: string;
}
export interface Generation {
  id: string; status: string; phase?: string | null; progress?: number | null;
  credits?: number | null; precharged_credits?: number | null; refund_status?: string | null;
  billing_duration?: number | null; settled_at?: string | null; results: Result[];
}
export interface PreparedGeneration {
  requestId: string; scope: string; idempotencyKey: string;
  body: Record<string, unknown>; quote: Quote;
}
export class DetailXError extends Error {
  constructor(message: string, public code = 'detailx_error', public status?: number) { super(message); this.name = 'DetailXError'; }
}
export interface RequestStore {
  get(scope: string, kind: string, id: string): Promise<Record<string, unknown> | undefined>;
  putOnce(scope: string, kind: string, id: string, value: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(scope: string, kind: string, id: string, value: Record<string, unknown>): Promise<void>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
function same(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) throw new DetailXError('Request ID is already bound to different immutable parameters', 'request_conflict');
}

/** Persistent local-volume store. Supply your own transactional DB store for serverless hosts. */
export class FileRequestStore implements RequestStore {
  constructor(public directory: string) {}
  private path(scope: string, kind: string, id: string) { return join(this.directory, hash(scope + '\0' + kind + '\0' + id) + '.json'); }
  async get(scope: string, kind: string, id: string) {
    try { return JSON.parse(await readFile(this.path(scope, kind, id), 'utf8')) as Record<string, unknown>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async putOnce(scope: string, kind: string, id: string, value: Record<string, unknown>) {
    const path = this.path(scope, kind, id);
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + '.' + randomUUID();
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    finally { await unlink(temporary); }
    return (await this.get(scope, kind, id))!;
  }
  async update(scope: string, kind: string, id: string, value: Record<string, unknown>) {
    const path = this.path(scope, kind, id);
    const temporary = path + '.' + randomUUID();
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  }
}

export function generationParams(source: Source, options: GenerationOptions = {}) {
  if (!!source.uploadId === !!source.sourceResultId) throw new DetailXError('Exactly one owned uploadId or sourceResultId is required', 'invalid_source');
  const allowed = ['resolution', 'fps', 'detail', 'light_correct', 'flow_smooth', 'keep_color', 'trajectory_smooth'];
  if (Object.keys(options).some(k => !allowed.includes(k))) throw new DetailXError('Unsupported generation option', 'invalid_options');
  const normalized = { resolution: '4K', fps: -1, ...Object.fromEntries(Object.entries(options).filter(([,v]) => v !== undefined)) };
  if (!['720p', '1080p', '2K', '4K'].includes(String(normalized.resolution)) || ![-1, 24, 30, 60].includes(Number(normalized.fps)) || typeof normalized.fps !== 'number') throw new DetailXError('Invalid resolution or fps', 'invalid_options');
  if (options.detail !== undefined && !['1', '2', '3'].includes(options.detail)) throw new DetailXError('detail must be a string: 1, 2 or 3', 'invalid_options');
  for (const k of allowed.slice(3)) if (k in normalized && typeof (normalized as Record<string,unknown>)[k] !== 'boolean') throw new DetailXError(k + ' must be boolean', 'invalid_options');
  return { ...normalized, ...(source.uploadId ? { upload_id: source.uploadId } : { source_result_id: source.sourceResultId }) };
}

export interface ClientOptions {
  apiKey?: string; baseURL?: string; store?: RequestStore; stateDir?: string;
  fetch?: typeof fetch; retries?: number; minRequestIntervalMs?: number;
  allowLocalTesting?: boolean; timeoutMs?: number;
}
export interface VideoMetadata { duration: number; width: number; height: number; codec: string; containers: string[]; videoStreams: number }
export interface UploadPolicy {
  min_bytes: number; effective_max_bytes: number; max_filename_length: number;
  max_parts: number; sign_batch_size: number; poll_interval_seconds: number;
  video: { codecs: string[]; containers: string[]; max_edge: number; max_pixels: number; max_streams: number; max_duration_seconds: number | null };
  thumbnail: { max_bytes: number; max_edge: number };
}
export interface UploadSession {
  id: string; asset_id: string; status: string; expires_at: string; part_bytes: number; part_count: number;
  resume_revision?: number; parts_revision?: number; uploaded_parts?: number[];
}

export class DetailXClient {
  readonly scope: string;
  readonly store: RequestStore;
  readonly baseURL: string;
  private apiKey: string;
  private fetcher: typeof fetch;
  private retries: number;
  private interval: number;
  private timeout: number;
  private nextRequest = 0;
  private local: boolean;
  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.DETAILX_API_KEY ?? '';
    this.baseURL = (options.baseURL ?? process.env.DETAILX_BASE ?? 'https://www.detail-x.ai/api/v1').replace(/\/$/, '');
    const url = new URL(this.baseURL);
    this.local = options.allowLocalTesting ?? false;
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(this.local && url.protocol === 'http:'))) throw new DetailXError('Invalid API base URL', 'invalid_base');
    if (!this.apiKey.startsWith('dxk_') || this.apiKey === 'dxk_REPLACE_ME') throw new DetailXError('DetailX API key required', 'missing_api_key');
    this.scope = hash(this.baseURL + '\0' + this.apiKey);
    this.store = options.store ?? new FileRequestStore(options.stateDir ?? process.env.DETAILX_STATE_DIR ?? '.detailx-state');
    this.fetcher = options.fetch ?? fetch;
    this.retries = options.retries ?? 3;
    this.interval = options.minRequestIntervalMs ?? 650;
    this.timeout = options.timeoutMs ?? 30000;
  }
  async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string, signal?: AbortSignal): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new DetailXError('Use API-relative paths', 'invalid_path');
    const retryable = method === 'GET' || !!idempotencyKey || path === '/generation-estimates';
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const slot = Math.max(Date.now(), this.nextRequest);
      this.nextRequest = slot + this.interval;
      if (slot > Date.now()) await delay(slot - Date.now(), undefined, { signal });
      let response: Response;
      try {
        response = await this.fetcher(this.baseURL + path, {
          method, redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.timeout)]),
          headers: { Authorization: 'Bearer ' + this.apiKey, Accept: 'application/json', 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (retryable && attempt < this.retries) { await delay(Math.min(1000 * 2 ** attempt, 10000), undefined, { signal }); continue; }
        throw new DetailXError('Transport failed; recover using the same request ID', 'transport_error');
      }
      if ([429, 502, 503, 504].includes(response.status) && retryable && attempt < this.retries) {
        const raw = response.headers.get('retry-after');
        const retryMs = raw ? (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 1000 * 2 ** attempt;
        await response.body?.cancel();
        await delay(Math.max(0, Math.min(Number.isFinite(retryMs) ? retryMs : 1000, 120000)), undefined, { signal });
        continue;
      }
      const data = await response.json().catch(() => ({})) as { detail?: { code?: string } };
      if (!response.ok) {
        const code = typeof data.detail?.code === 'string' ? data.detail.code : 'http_' + response.status;
        throw new DetailXError(`DetailX returned ${response.status} (${code})`, code, response.status);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DetailXError('Invalid API response', 'invalid_response');
      return data as T;
    }
  }
  account() { return this.request<{ id: string; point: number }>('GET', '/auth/me'); }
  capabilities() { return this.request<Record<string, unknown>>('GET', '/generation-capabilities'); }
  capacity() { return this.request<Record<string, unknown>>('GET', '/generation-capacity'); }
  uploadPolicy() { return this.request<UploadPolicy>('GET', '/upload-policy'); }
  getGeneration(id: string, signal?: AbortSignal) { return this.request<Generation>('GET', '/generations/' + encodeURIComponent(id), undefined, undefined, signal); }
  estimate(source: Source, options: GenerationOptions = {}, signal?: AbortSignal) { return this.request<Quote>('POST', '/generation-estimates', generationParams(source, options), undefined, signal); }
  async prepareGeneration(source: Source, options: GenerationOptions, settings: { requestId: string; maxPrechargeCredits: number; signal?: AbortSignal }): Promise<PreparedGeneration> {
    const { requestId, maxPrechargeCredits, signal } = settings;
    if (!requestId || !Number.isSafeInteger(maxPrechargeCredits) || maxPrechargeCredits < 0) throw new DetailXError('A stable requestId and nonnegative integer maxPrechargeCredits are required', 'invalid_budget');
    const params = generationParams(source, options);
    let stored = await this.store.get(this.scope, 'generation', requestId);
    if (!stored) {
      const quote = await this.estimate(source, options, signal);
      if (!Number.isSafeInteger(quote.credits) || quote.credits < 0 || !Number.isSafeInteger(quote.pricing_revision_id) || quote.pricing_revision_id < 1) throw new DetailXError('Invalid quote', 'invalid_response');
      if (quote.credits > maxPrechargeCredits) throw new DetailXError('Quote exceeds the precharge budget', 'budget_exceeded');
      const prepared: PreparedGeneration = { requestId, scope: this.scope, idempotencyKey: 'dx-gen-' + hash(this.scope + requestId).slice(0, 48), body: { ...params, expected_credits: quote.credits, pricing_revision_id: quote.pricing_revision_id }, quote };
      stored = await this.store.putOnce(this.scope, 'generation', requestId, { params, prepared });
    }
    same(stored.params, params);
    const prepared = stored.prepared as PreparedGeneration;
    if (prepared.quote.credits > maxPrechargeCredits) throw new DetailXError('Saved quote exceeds budget', 'budget_exceeded');
    return prepared;
  }
  async submit(prepared: PreparedGeneration, signal?: AbortSignal): Promise<Generation> {
    if (prepared.scope !== this.scope) throw new DetailXError('Prepared request belongs to another credential', 'credential_mismatch');
    const stored = await this.store.get(this.scope, 'generation', prepared.requestId);
    if (!stored) throw new DetailXError('Durable prepared request is missing', 'missing_prepared_request');
    same(stored.prepared, prepared);
    if (stored.generationId) return this.getGeneration(String(stored.generationId), signal);
    const job = await this.request<Generation>('POST', '/generations', prepared.body, prepared.idempotencyKey, signal);
    if (!job.id) throw new DetailXError('Accepted response lacks generation ID', 'invalid_response');
    await this.store.update(this.scope, 'generation', prepared.requestId, { ...stored, generationId: job.id });
    return job;
  }
  async wait(id: string, options: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal; onProgress?: (job: Generation) => void } = {}) {
    if ((options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) || (options.pollIntervalMs !== undefined && (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0))) throw new DetailXError('Wait times must be positive finite numbers', 'invalid_options');
    const deadline = Date.now() + (options.timeoutMs ?? 1800000);
    for (;;) {
      const job = await this.getGeneration(id, options.signal);
      options.onProgress?.(job);
      if (job.status === 'completed') return job;
      if (job.status === 'failed') throw new DetailXError('Generation failed; refund state: ' + job.refund_status, 'generation_failed');
      if (Date.now() >= deadline) throw new DetailXError('Local wait timed out; accepted server job continues. Recover ' + id, 'wait_timeout');
      await delay(Math.min(Math.max(1000, options.pollIntervalMs ?? 10000), deadline - Date.now()), undefined, { signal: options.signal });
    }
  }
  /** Caller supplies decoded metadata and first-frame JPEG; use sdk-python[media] to prepare them. */
  async uploadFile(path: string, settings: { requestId: string; metadata: VideoMetadata; thumbnail: Uint8Array; signal?: AbortSignal; onProgress?: (part: number, total: number) => void }): Promise<UploadSession> {
    const policy = await this.uploadPolicy();
    const info = await stat(path);
    const m = settings.metadata;
    if (info.size < policy.min_bytes || info.size > policy.effective_max_bytes || basename(path).length > Math.min(255, policy.max_filename_length)) throw new DetailXError('File violates upload policy', 'invalid_media');
    if (!Number.isFinite(m.duration) || m.duration <= 0 || !Number.isInteger(m.width) || !Number.isInteger(m.height) || Math.min(m.width,m.height) < 1 || Math.max(m.width,m.height) > policy.video.max_edge || m.width*m.height > policy.video.max_pixels || m.videoStreams > policy.video.max_streams || !policy.video.codecs.includes(m.codec) || !m.containers.some(c => policy.video.containers.includes(c)) || (policy.video.max_duration_seconds != null && m.duration > policy.video.max_duration_seconds) || settings.thumbnail.byteLength > policy.thumbnail.max_bytes) throw new DetailXError('Video metadata or thumbnail violates upload policy', 'invalid_media');
    const sha = createHash('sha256');
    for await (const block of createReadStream(path)) { settings.signal?.throwIfAborted(); sha.update(block); }
    const body = { filename: basename(path), size_bytes: info.size, fingerprint: sha.digest('hex'), duration: m.duration, width: m.width, height: m.height };
    const stored = await this.store.putOnce(this.scope, 'upload', settings.requestId, { body });
    same(stored.body, body);
    const resumed = !!stored.sessionId;
    let session = resumed ? await this.request<UploadSession>('GET', '/upload-sessions/' + encodeURIComponent(String(stored.sessionId))) : await this.request<UploadSession>('POST', '/upload-sessions', body, 'dx-up-' + hash(this.scope + settings.requestId).slice(0,48), settings.signal);
    await this.store.update(this.scope, 'upload', settings.requestId, { ...stored, sessionId: session.id });
    const prefix = '/upload-sessions/' + encodeURIComponent(session.id);
    const expiry = Date.parse(session.expires_at);
    if (!Number.isFinite(expiry)) throw new DetailXError('Invalid upload expiry', 'invalid_response');
    const check = () => { settings.signal?.throwIfAborted(); if (Date.now() >= expiry) throw new DetailXError('Upload expired; recover the same request ID', 'upload_timeout'); };
    const waitFor = async (predicate: (s: UploadSession) => boolean) => {
      for (;;) {
        if (['failed','rejected','cancelled','expired'].includes(session.status)) throw new DetailXError('Upload is ' + session.status, 'upload_failed');
        if (session.status === 'ready' || predicate(session)) return;
        check(); await delay(Math.min(1000*Math.max(1,policy.poll_interval_seconds),expiry-Date.now()), undefined, { signal: settings.signal });
        session = await this.request<UploadSession>('GET', prefix, undefined, undefined, settings.signal);
      }
    };
    await waitFor(s => s.status === 'uploading');
    if (session.status === 'ready') return session;
    if (resumed) {
      session = await this.request<UploadSession>('POST', prefix + '/resume', { fingerprint: body.fingerprint }, undefined, settings.signal);
      const revision = session.resume_revision;
      if (revision === undefined) throw new DetailXError('Unconfirmed resume revision', 'invalid_response');
      await waitFor(s => (s.parts_revision ?? -1) >= revision);
      if (session.status === 'ready') return session;
    }
    if (session.part_bytes <= 0 || session.part_count !== Math.ceil(info.size/session.part_bytes) || session.part_count > policy.max_parts) throw new DetailXError('Invalid part layout', 'invalid_response');
    type Signed = { number?: number; url: string; headers: Record<string,string> };
    const put = async (signed: Signed, data: Uint8Array) => {
      check();
      const url = new URL(signed.url);
      if (url.protocol !== 'https:' && !this.local || url.username || url.password) throw new DetailXError('Unsafe upload URL', 'unsafe_url');
      if (Object.keys(signed.headers).some(h => ['authorization','cookie','proxy-authorization'].includes(h.toLowerCase()))) throw new DetailXError('Unsafe signature header', 'unsafe_signature');
      const response = await this.fetcher(signed.url, { method: 'PUT', headers: { ...signed.headers, 'Content-Length': String(data.byteLength) }, body: Buffer.from(data), redirect: 'error', signal: AbortSignal.any([...(settings.signal ? [settings.signal] : []), AbortSignal.timeout(Math.min(300000, Math.max(1,expiry-Date.now())))]) });
      if (!response.ok) throw new DetailXError('Signed PUT failed; recover the same upload request ID', 'upload_put_failed');
    };
    const checksum = (data: Uint8Array) => createHash('md5').update(data).digest('base64');
    const cover = await this.request<Signed>('POST', prefix + '/thumbnail', { size_bytes: settings.thumbnail.byteLength, md5: checksum(settings.thumbnail) }, undefined, settings.signal);
    await put(cover, settings.thumbnail);
    const confirmed = new Set(session.uploaded_parts ?? []);
    const missing = Array.from({length: session.part_count}, (_,i) => i+1).filter(n => !confirmed.has(n));
    const size = Math.max(1,Math.min(16,policy.sign_batch_size));
    const file = await open(path,'r');
    const part = async (number: number) => {
      const latest = await stat(path);
      if (latest.size !== info.size || latest.mtimeMs !== info.mtimeMs) throw new DetailXError('Source changed during upload', 'file_changed');
      const length = Math.min(session.part_bytes,info.size-(number-1)*session.part_bytes);
      const buffer = Buffer.alloc(length);
      let offset=0;
      while (offset < length) { const read = await file.read(buffer, offset, length-offset, (number-1)*session.part_bytes+offset); if (!read.bytesRead) throw new DetailXError('Unexpected end of source', 'file_changed'); offset += read.bytesRead; }
      return buffer;
    };
    try {
      for (let i=0; i<missing.length; i+=size) {
        const numbers = missing.slice(i,i+size);
        const parts: {number:number;md5:string}[] = [];
        for (const number of numbers) parts.push({number,md5:checksum(await part(number))});
        const signed = await this.request<{parts: Signed[]}>('POST',prefix+'/parts',{parts},undefined,settings.signal);
        for (const number of numbers) {
          const signature = signed.parts.find(s=>s.number===number);
          if (!signature) throw new DetailXError('Missing part signature','invalid_response');
          await put(signature,await part(number)); settings.onProgress?.(number,session.part_count);
        }
      }
    } finally { await file.close(); }
    session = await this.request<UploadSession>('POST',prefix+'/complete',undefined,undefined,settings.signal);
    await waitFor(s=>s.status==='ready');
    return session;
  }
}
