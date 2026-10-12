import { FetchError } from './types';
import type {
  ApiResponse,
  FetchClientConfig,
  FetchErrorKind,
  HeaderInput,
  QueryValue,
  RequestOptions,
  RetryContext,
  RetryInfo,
} from './types';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 30_000;

/** Object lookup is O(1) and inline-cacheable — faster than Set.has for strings. */
const IDEMPOTENT: Record<string, 1> = {
  GET: 1,
  HEAD: 1,
  PUT: 1,
  DELETE: 1,
  OPTIONS: 1,
  TRACE: 1,
};

/* -------------------------------------------------------------------------- */
/* Internal helpers (all zero-allocation unless they must allocate)           */
/* -------------------------------------------------------------------------- */

function normalizeHeaders(
  target: Record<string, string>,
  source: HeaderInput,
): void {
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target[key.toLowerCase()] = value;
    });
    return;
  }
  if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) {
      const pair = source[i] as readonly [string, string];
      target[pair[0].toLowerCase()] = pair[1];
    }
    return;
  }
  for (const key in source as Record<string, string>) {
    target[key.toLowerCase()] = (source as Record<string, string>)[key]!;
  }
}

function cloneHeaders(src: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const k in src) out[k] = src[k]!;
  return out;
}

function buildQuery(params: Record<string, QueryValue> | undefined): string {
  if (params === undefined) return '';
  let qs = '';
  let sep = '?';
  for (const key in params) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    const encKey = encodeURIComponent(key);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i];
        if (v === undefined || v === null) continue;
        qs += sep + encKey + '=' + encodeURIComponent(String(v));
        sep = '&';
      }
    } else {
      qs += sep + encKey + '=' + encodeURIComponent(String(value));
      sep = '&';
    }
  }
  return qs;
}

/** True if `body` would be JSON-encoded (and therefore needs a Content-Type). */
function isJsonBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const proto = Object.getPrototypeOf(body);
  return proto === null || proto === Object.prototype || Array.isArray(body);
}

function prepareBody(
  body: unknown,
  headers: Record<string, string>,
): RequestInit['body'] | undefined {
  if (body === undefined || body === null) return undefined;

  const t = typeof body;
  if (t === 'string') return body as string;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(body);

  // Fast path for JSON-able objects: no instanceof chain, one proto check.
  if (isJsonBody(body)) {
    if (headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json';
    }
    return JSON.stringify(body);
  }

  // Blob / FormData / URLSearchParams / ArrayBuffer / TypedArray / ReadableStream
  return body as RequestInit['body'];
}

function computeBackoff(
  attempt: number,
  base: number,
  retryAfterMs: number | undefined,
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs > MAX_RETRY_DELAY_MS ? MAX_RETRY_DELAY_MS : retryAfterMs;
  }
  const exp = base * (1 << (attempt - 1));
  const jitter = Math.random() * base;
  const total = exp + jitter;
  return total > MAX_RETRY_DELAY_MS ? MAX_RETRY_DELAY_MS : total;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n > 0 ? n * 1000 : 0;
  const d = Date.parse(header);
  if (Number.isFinite(d)) {
    const delta = d - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(signal.reason);
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort !== undefined) signal!.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal !== undefined) {
      onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function parseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) return null as unknown as T;
  // Cheap rejection: JSON payloads nearly always start with `{` or `[`.
  const c = text.charCodeAt(0);
  if (c === 123 /* { */ || c === 91 /* [ */) {
    try {
      return JSON.parse(text) as T;
    } catch {
      /* fall through */
    }
  } else {
    try {
      return JSON.parse(text) as T;
    } catch {
      /* fall through */
    }
  }
  return text as unknown as T;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export class FetchClient {
  private readonly baseURL: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRetry: ((info: RetryInfo) => void) | undefined;
  private readonly shouldRetry: ((info: RetryContext) => boolean) | undefined;

  constructor(baseURL: string = '', config: FetchClientConfig = {}) {
    this.baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;

    const headers: Record<string, string> = Object.create(null);
    if (config.headers !== undefined) normalizeHeaders(headers, config.headers);
    this.defaultHeaders = headers;

    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.onRetry = config.onRetry;
    this.shouldRetry = config.shouldRetry;
  }

  async request<T = unknown>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const rawBody = options.body;
    const method = (options.method ?? 'GET').toUpperCase();
    const url = this.baseURL + endpoint + buildQuery(options.params);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const canRetry = maxRetries > 0 && IDEMPOTENT[method] === 1;

    /* ---- Headers: only clone if we might write to them ---------------- */
    const rawHeaders = options.headers;
    const needHeaderClone = rawHeaders !== undefined || isJsonBody(rawBody);

    let headers: Record<string, string>;
    if (needHeaderClone) {
      headers = cloneHeaders(this.defaultHeaders);
      if (rawHeaders !== undefined) normalizeHeaders(headers, rawHeaders);
    } else {
      headers = this.defaultHeaders;
    }

    /* ---- Body -------------------------------------------------------- */
    const body = prepareBody(rawBody, headers);

    /* ---- Signal / timeout -------------------------------------------- */
    const callerSignal = options.signal;
    const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const needSignal = useTimeout || callerSignal !== undefined;

    /* ---- Build RequestInit once -------------------------------------- */
    const init: RequestInit & Record<string, unknown> = {
      method,
      headers,
    };
    if (body !== undefined) init.body = body;

    // Copy through remaining RequestInit fields (cache, credentials, mode, ...)
    for (const key in options) {
      switch (key) {
        case 'headers':
        case 'body':
        case 'params':
        case 'timeoutMs':
        case 'maxRetries':
        case 'signal':
        case 'method':
          break;
        default:
          (init as Record<string, unknown>)[key] = (options as Record<string, unknown>)[key];
          break;
      }
    }

    /* ---- Attempt loop ------------------------------------------------- */
    for (let attempt = 0; ; attempt++) {
      let controller: AbortController | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let onCallerAbort: (() => void) | undefined;
      let timedOut = false;

      if (needSignal) {
        controller = new AbortController();
        init.signal = controller.signal;
        if (callerSignal !== undefined) {
          if (callerSignal.aborted) {
            controller.abort(callerSignal.reason);
          } else {
            const ctrl = controller;
            onCallerAbort = () => ctrl.abort(callerSignal.reason);
            callerSignal.addEventListener('abort', onCallerAbort, { once: true });
          }
        }
        if (useTimeout) {
          const ctrl = controller;
          timeoutId = setTimeout(() => {
            timedOut = true;
            ctrl.abort();
          }, timeoutMs);
        }
      } else {
        init.signal = undefined;
      }

      let response: Response | undefined;
      let data: T | undefined;
      let error: unknown;

      try {
        response = await this.fetchImpl(url, init as RequestInit);
        data = await parseBody<T>(response);
      } catch (e) {
        error = e;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (onCallerAbort !== undefined && callerSignal !== undefined) {
          callerSignal.removeEventListener('abort', onCallerAbort);
        }
      }

      // Caller-initiated abort — never retry, always surface as FetchError('abort').
      if (callerSignal !== undefined && callerSignal.aborted) {
        throw new FetchError('Request aborted by caller', 'abort', error);
      }

      const hasResponse = response !== undefined;
      const isHttpError = hasResponse && !response!.ok;

      const withinBudget = canRetry && attempt < maxRetries;
      const retryable = !hasResponse
        ? true
        : isHttpError
          ? isRetryableStatus(response!.status)
          : false;

      // ---- Terminal: return or throw --------------------------------
      if (!withinBudget || !retryable || !this._userWantsRetry(attempt, maxRetries, method, url, response, error, timedOut)) {
        if (hasResponse) {
          return {
            ok: response!.ok,
            status: response!.status,
            data: data as T,
            headers: response!.headers,
          };
        }
        const kind: FetchErrorKind = timedOut ? 'timeout' : 'network';
        throw new FetchError(
          timedOut ? 'Request timed out' : 'Network request failed',
          kind,
          error,
        );
      }

      // ---- Backoff --------------------------------------------------
      const retryAfterMs = hasResponse
        ? parseRetryAfter(response!.headers.get('retry-after'))
        : undefined;
      const delayMs = computeBackoff(attempt + 1, this.retryBaseDelayMs, retryAfterMs);

      if (this.onRetry !== undefined) {
        this.onRetry({
          attempt: attempt + 1,
          maxRetries,
          method,
          url,
          status: hasResponse ? response!.status : undefined,
          error: hasResponse ? undefined : error,
          delayMs,
        });
      }

      if (delayMs > 0) {
        try {
          await sleep(delayMs, callerSignal);
        } catch (e) {
          throw new FetchError('Request aborted by caller', 'abort', e);
        }
      }
    }
  }

  /**
   * Extracted to keep the hot loop monomorphic. Returns true if the caller
   * (via `shouldRetry`) explicitly wants a retry, or if no hook is installed.
   */
  private _userWantsRetry(
    attempt: number,
    maxRetries: number,
    method: string,
    url: string,
    response: Response | undefined,
    error: unknown,
    timedOut: boolean,
  ): boolean {
    if (this.shouldRetry === undefined) return true;
    const ctx: RetryContext = {
      attempt: attempt + 1,
      maxRetries,
      method,
      url,
      status: response !== undefined ? response.status : undefined,
      error: response !== undefined ? undefined : timedOut ? new Error('timeout') : error,
    };
    return this.shouldRetry(ctx);
  }

  /* ------------------------------------------------------------------------ */
  /* Convenience methods                                                      */
  /* ------------------------------------------------------------------------ */

  get<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  patch<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  delete<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}