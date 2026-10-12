import { pino } from 'pino';
import { appConfig } from '@/configs/app.configs';

export const logger = pino({
  name: 'bank-middleware',
  level: process.env.LOG_LEVEL ?? 'info',
  base: { env: appConfig.env },
});