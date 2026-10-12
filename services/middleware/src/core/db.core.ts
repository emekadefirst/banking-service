
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/core/models.core";
import { databaseConfigs } from "@/configs/db.configs";

type PgClient = ReturnType<typeof postgres>;
type DrizzleDb = ReturnType<typeof drizzle>;

let clientInstance: PgClient | null = null;
let dbInstance: DrizzleDb | null = null;

function initializeDatabase() {
  if (dbInstance) return dbInstance;

  try {
    const connectionString = databaseConfigs.dbUrl;
    if (!connectionString) {
      throw new Error("DBURL not configured");
    }

    clientInstance = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress notices
    });

    dbInstance = drizzle(clientInstance, { schema });
    console.log("[DB] Connected successfully");
    return dbInstance;
  } catch (error) {
    console.error("[DB] Initialization failed:", error);
    throw error;
  }
}


export const client: PgClient = new Proxy(function () {}, {
  apply(_target, thisArg, args) {
    if (!clientInstance) initializeDatabase();
    return Reflect.apply(clientInstance as any, thisArg, args);
  },
  get(_target, prop) {
    if (!clientInstance) initializeDatabase();
    return (clientInstance as any)[prop];
  },
}) as any;

export const db: DrizzleDb = new Proxy({} as any, {
  get(_target, prop) {
    if (!dbInstance) initializeDatabase();
    return (dbInstance as any)[prop];
  },
}) as any;