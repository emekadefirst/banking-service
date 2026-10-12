export const appConfig = {
  port: Number(process.env.APP_PORT || 3000),
 
  host: process.env.HOST || "0.0.0.0",
  env: (process.env.NODE_ENV || "development") as
    | "development"
    | "staging"
    | "production"
    | "test",
  apiVersion: process.env.API_VERSION || "v1",
  baseUrl: process.env.APP_BASE_URL || "http://localhost:3003",
  internalSecret: process.env.INTERNAL_SECRET || "",
  isProd: process.env.NODE_ENV === "production",
} as const;
