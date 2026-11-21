import { MongoClient, type Db } from "mongodb";
import { getEnv } from "./env";
import { assertSafeDatabase } from "./db-guard";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const config = getEnv();
  assertSafeDatabase(config);

  const client = new MongoClient(config.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();
    const db = client.db(config.MONGODB_DB);
    cachedClient = client;
    cachedDb = db;
    console.log("Connected to MongoDB.");
    return { client, db };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
