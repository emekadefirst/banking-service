export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type ServiceStatus = 'healthy' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: ServiceStatus;
  url: string;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  services: HealthCheckResult[];
}

const TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 5000);

const checks: { name: string; url: string }[] = [
  {
    name: 'blnk',
    url: process.env.BLNK_HEALTH_URL ?? 'http://localhost:5001/health',
  },
  {
    name: 'fineract',
    url:
      process.env.FINERACT_HEALTH_URL ??
      `http://localhost:${process.env.FINERACT_SERVER_PORT ?? 8443}/fineract-provider/actuator/health`,
  },
];

async function checkHttp(url: string): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return {
      name: url,
      status: res.ok ? 'healthy' : 'unhealthy',
      url,
      latencyMs: Date.now() - startedAt,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    return {
      name: url,
      status: 'unhealthy',
      url,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runHealthChecks(): Promise<HealthReport> {
  const results = await Promise.all(checks.map((c) => checkHttp(c.url)));

  const healthy = results.filter((r) => r.status === 'healthy').length;
  const status: HealthStatus =
    healthy === results.length ? 'healthy' : healthy === 0 ? 'unhealthy' : 'degraded';

  return {
    status,
    checkedAt: new Date().toISOString(),
    services: results,
  };
}