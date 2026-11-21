#!/usr/bin/env node

const errors = [];

function read(name) {
  return (process.env[name] || "").trim();
}

const appEnv = read("APP_ENV");
const mongodbUri = read("MONGODB_URI");
const mongodbDb = read("MONGODB_DB");
const productionDbName = read("PRODUCTION_DB_NAME");
const allowProductionDb = read("ALLOW_PRODUCTION_DB").toLowerCase() === "true";

const validAppEnvs = ["development", "test", "staging", "production"];

if (!appEnv) {
  errors.push("APP_ENV is required.");
} else if (!validAppEnvs.includes(appEnv)) {
  errors.push("APP_ENV must be one of: development, test, staging, production.");
}

if (!mongodbUri) {
  errors.push("MONGODB_URI is required.");
} else if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
  errors.push("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
}

if (!mongodbDb) {
  errors.push("MONGODB_DB is required and has no default.");
}

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
} else if (appEnv) {
  if (allowProductionDb) {
    errors.push("ALLOW_PRODUCTION_DB must not be true unless APP_ENV=production.");
  }
  if (productionDbName && mongodbDb && mongodbDb === productionDbName) {
    errors.push("Refusing to use the production database outside APP_ENV=production.");
  }
}

if (errors.length > 0) {
  console.error("Database guard failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Database guard passed (APP_ENV=${appEnv}, MONGODB_DB=${mongodbDb}).`);
