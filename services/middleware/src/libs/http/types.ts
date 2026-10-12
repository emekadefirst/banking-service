export interface RetryContext {
  attempt: number;
  maxRetries: number;
  method: string;
  url: string;
  status?: number;
  error?: unknown;
}

export interface RetryInfo extends RetryContext {
  delayMs: number;
}

/**
 * Fast path: `Record<string, string>` (keys normalized to lowercase internally).
 * Slow path (still supported): native `Headers`, or tuples. Prefer plain objects.
 */
export type HeaderInput =
  | Record<string, string>
  | Headers
  | readonly (readonly [string, string])[];

export interface FetchClientConfig {
  headers?: HeaderInput;
  /** Default 30_000. Set to 0 or Infinity to disable. */
  timeoutMs?: number;
  /** Default 3. Only applied to idempotent methods. */
  maxRetries?: number;
  /** Default 300. Base for exponential backoff with full jitter. */
  retryBaseDelayMs?: number;
  /** Inject a fetch impl (tests). Defaults to `globalThis.fetch` (native Bun). */
  fetch?: typeof fetch;
  onRetry?: (info: RetryInfo) => void;
  /** Return false to stop retrying. Only called when a retry is otherwise possible. */
  shouldRetry?: (info: RetryContext) => boolean;
}

export type QueryPrimitive = string | number | boolean;
export type QueryValue =
  | QueryPrimitive
  | null
  | undefined
  | readonly QueryPrimitive[];

export interface RequestOptions
  extends Omit<RequestInit, 'body' | 'headers' | 'signal'> {
  headers?: HeaderInput;
  body?: unknown;
  params?: Record<string, QueryValue>;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers: Headers;
}

export type FetchErrorKind = 'timeout' | 'network' | 'abort';

/**
 * Thrown only for transport failures (network error, timeout, caller abort).
 * HTTP error responses (4xx/5xx) are returned with ok=false — never thrown.
 */
export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  override readonly cause?: unknown;

  constructor(message: string, kind: FetchErrorKind, cause?: unknown) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    this.cause = cause;
  }
}