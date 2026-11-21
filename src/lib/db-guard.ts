import { getEnv, type AppEnvConfig } from "./env";

export function assertSafeDatabase(config: AppEnvConfig = getEnv()): string {
  if (!config.MONGODB_DB) {
    throw new Error("Database guard failed: MONGODB_DB is not configured.");
  }

  if (config.APP_ENV === "production") {
    if (!config.PRODUCTION_DB_NAME) {
      throw new Error("Database guard failed: PRODUCTION_DB_NAME is not configured.");
    }
    if (!config.ALLOW_PRODUCTION_DB) {
      throw new Error("Database guard failed: ALLOW_PRODUCTION_DB is not enabled.");
    }
    if (config.MONGODB_DB !== config.PRODUCTION_DB_NAME) {
      throw new Error("Database guard failed: MONGODB_DB does not match PRODUCTION_DB_NAME.");
    }
    return config.MONGODB_DB;
  }

  if (config.ALLOW_PRODUCTION_DB) {
    throw new Error("Database guard failed: production access is not allowed outside production.");
  }

  if (config.PRODUCTION_DB_NAME && config.MONGODB_DB === config.PRODUCTION_DB_NAME) {
    throw new Error("Database guard failed: refusing to use the production database.");
  }

  return config.MONGODB_DB;
}
