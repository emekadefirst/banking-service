import { defineConfig } from "drizzle-kit";
import { databaseConfigs } from "@/configs/db.configs";

export default defineConfig({
  out: "./drizzle", 
  schema: [
    "./src/modules/**/models.ts",
    "./src/dependencies/**/models.ts",
    "./src/domain/**/models.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: databaseConfigs.dbUrl!,
   
  },
  verbose: true,
  strict: true,
});