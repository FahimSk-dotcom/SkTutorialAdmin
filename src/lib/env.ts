export type AppEnv = "development" | "test" | "staging" | "production";

export interface AppEnvConfig {
  APP_ENV: AppEnv;
  MONGODB_URI: string;
  MONGODB_DB: string;
  PRODUCTION_DB_NAME?: string;
  ALLOW_PRODUCTION_DB: boolean;
  JWT_ADMIN_SECRET: string;
  JWT_PARENT_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  CRON_SECRET: string;
  NEXT_PUBLIC_APP_URL: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  PRODUCTION_MIGRATION_APPROVED: boolean;
}

const APP_ENVS: AppEnv[] = ["development", "test", "staging", "production"];

let cachedConfig: AppEnvConfig | null = null;

function read(source: NodeJS.ProcessEnv, name: string): string {
  return (source[name] ?? "").trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateEnv(source: NodeJS.ProcessEnv = process.env): AppEnvConfig {
  const errors: string[] = [];

  const appEnvRaw = read(source, "APP_ENV");
  if (!appEnvRaw) {
    errors.push("APP_ENV is required and must be one of: development, test, staging, production.");
  } else if (!APP_ENVS.includes(appEnvRaw as AppEnv)) {
    errors.push("APP_ENV must be one of: development, test, staging, production.");
  }
  const appEnv = appEnvRaw as AppEnv;

  const mongodbUri = read(source, "MONGODB_URI");
  if (!mongodbUri) {
    errors.push("MONGODB_URI is required.");
  } else if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
    errors.push("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
  }

  const mongodbDb = read(source, "MONGODB_DB");
  if (!mongodbDb) {
    errors.push("MONGODB_DB is required and has no default.");
  }

  const productionDbName = read(source, "PRODUCTION_DB_NAME") || undefined;
  const allowProductionDb = read(source, "ALLOW_PRODUCTION_DB").toLowerCase() === "true";

  if (!productionDbName) {
    errors.push("PRODUCTION_DB_NAME is required.");
  }

  if (appEnv === "production") {
    if (!allowProductionDb) {
      errors.push("ALLOW_PRODUCTION_DB must be exactly true when APP_ENV=production.");
    }
    if (productionDbName && mongodbDb && mongodbDb !== productionDbName) {
      errors.push("MONGODB_DB must match PRODUCTION_DB_NAME when APP_ENV=production.");
    }
  } else {
    if (allowProductionDb) {
      errors.push("ALLOW_PRODUCTION_DB must not be true unless APP_ENV=production.");
    }
    if (productionDbName && mongodbDb && mongodbDb === productionDbName) {
      errors.push("Refusing to use the production database outside APP_ENV=production.");
    }
  }

  const jwtAdminSecret = read(source, "JWT_ADMIN_SECRET");
  if (!jwtAdminSecret) {
    errors.push("JWT_ADMIN_SECRET is required.");
  } else if (jwtAdminSecret.length < 32) {
    errors.push("JWT_ADMIN_SECRET must be at least 32 characters.");
  }

  const jwtParentSecret = read(source, "JWT_PARENT_SECRET") || undefined;
  if (jwtParentSecret && jwtParentSecret.length < 32) {
    errors.push("JWT_PARENT_SECRET must be at least 32 characters when provided.");
  }

  const cronSecret = read(source, "CRON_SECRET");
  if (!cronSecret) {
    errors.push("CRON_SECRET is required.");
  } else if (cronSecret.length < 16) {
    errors.push("CRON_SECRET must be at least 16 characters.");
  }

  const appUrl = read(source, "NEXT_PUBLIC_APP_URL");
  if (!appUrl) {
    errors.push("NEXT_PUBLIC_APP_URL is required.");
  } else if (!isHttpUrl(appUrl)) {
    errors.push("NEXT_PUBLIC_APP_URL must be a valid http or https URL.");
  }

  const adminEmail = read(source, "ADMIN_EMAIL") || undefined;
  const adminPassword = read(source, "ADMIN_PASSWORD") || undefined;

  if (appEnv === "production") {
    if (!adminEmail) {
      errors.push("ADMIN_EMAIL is required when APP_ENV=production.");
    } else if (!isEmail(adminEmail)) {
      errors.push("ADMIN_EMAIL must be a valid email address.");
    }
    if (!adminPassword) {
      errors.push("ADMIN_PASSWORD is required when APP_ENV=production.");
    } else if (adminPassword.length < 8) {
      errors.push("ADMIN_PASSWORD must be at least 8 characters when APP_ENV=production.");
    }
  }

  const upstashUrl = read(source, "UPSTASH_REDIS_REST_URL") || undefined;
  const upstashToken = read(source, "UPSTASH_REDIS_REST_TOKEN") || undefined;
  if ((upstashUrl && !upstashToken) || (!upstashUrl && upstashToken)) {
    errors.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join("\n- ")}`);
  }

  return {
    APP_ENV: appEnv,
    MONGODB_URI: mongodbUri,
    MONGODB_DB: mongodbDb,
    PRODUCTION_DB_NAME: productionDbName,
    ALLOW_PRODUCTION_DB: allowProductionDb,
    JWT_ADMIN_SECRET: jwtAdminSecret,
    JWT_PARENT_SECRET: jwtParentSecret,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    CRON_SECRET: cronSecret,
    NEXT_PUBLIC_APP_URL: appUrl,
    FIREBASE_SERVICE_ACCOUNT: read(source, "FIREBASE_SERVICE_ACCOUNT") || undefined,
    UPSTASH_REDIS_REST_URL: upstashUrl,
    UPSTASH_REDIS_REST_TOKEN: upstashToken,
    PRODUCTION_MIGRATION_APPROVED:
      read(source, "PRODUCTION_MIGRATION_APPROVED").toLowerCase() === "true",
  };
}

export function getEnv(): AppEnvConfig {
  if (!cachedConfig) {
    cachedConfig = validateEnv();
  }
  return cachedConfig;
}

export function requireAdminCredentials(): { email: string; password: string } {
  const config = getEnv();
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD are required to provision the initial admin account."
    );
  }
  return { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD };
}
