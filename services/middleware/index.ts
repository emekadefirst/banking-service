import { Elysia } from 'elysia';
import { node } from '@elysia/node';
import { cors } from '@elysia/cors';
import { openapi } from '@elysia/openapi';
import { appConfig } from '@/configs/app.configs';
import { runHealthChecks } from '@/core/health';
import { logger } from '@/core/logger';


function createElysiaRoot() {
  const forced = process.env.ELYSIA_RUNTIME?.trim().toLowerCase();
  if (forced === 'node') return new Elysia({ adapter: node() });
  if (forced === 'bun') return new Elysia();
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? new Elysia()
    : new Elysia({ adapter: node() });
}

const buildApp = () =>
  createElysiaRoot()
    .onRequest(({ request }) => {
      logger.info(
        { method: request.method, url: request.url },
        'incoming request'
      );
    })
    .onAfterHandle(({ request, set }) => {
      logger.info(
        { method: request.method, url: request.url, status: set.status ?? 200 },
        'request completed'
      );
    })
    .onError(({ request, error, set }) => {
      logger.error(
        { method: request.method, url: request.url, status: set.status, error },
        'request failed'
      );
    })
    .use(
      openapi({
        documentation: {
          info: {
            title: 'Core Banking Service ',
            version: '1.0.0',
            description: 'API for banking service',
            contact: {
              name: 'Banking Service',
              url: 'example.com',
            },
          },
          
          components: {
            securitySchemes: {
              apiKey: {
                type: 'apiKey',
                description: 'API Key for service-to-service authentication',
                name: 'x-api-key',
                in: 'header',
              },
              authToken: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Bearer token from /auth/login endpoint',
              },
            },
          },
        },
        path: '/docs',
        embedSpec: false,
        scalar: {
          tagsSorter: 'alpha',
          version: '1.52.2',
          ...(process.env.SCALAR_OPENAPI_URL ? { url: process.env.SCALAR_OPENAPI_URL } : {}),
        }
      })
    )
    .use(cors())
    .get(
      '/health',
      async ({ set }) => {
        const report = await runHealthChecks();
        if (report.status === 'unhealthy') set.status = 503;
        else if (report.status === 'degraded') set.status = 200;
        return report;
      },
      { detail: { hide: true, summary: 'Infrastructure health check' } }
    )
    .get(
      '/',
      () => ({
        success: true,
        message: 'Banking API',
        version: '1.0.0',
        apiVersion: appConfig.apiVersion,
      }),
      { detail: { hide: true } }
    )

    // .use(billingModule)
    /*
      
      
      .use(contactsSmsModule)
      .use(smsModule)
       */;

const app = buildApp().listen({
  port: appConfig.port,
  hostname: appConfig.host,
});

logger.info(
  {
    env: appConfig.env,
    url: `http://${appConfig.host}:${appConfig.port}`,
  },
  'middleware started'
);