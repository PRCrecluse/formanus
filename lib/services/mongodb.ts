'use server';

import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'aipersona';

let prodClientPromise: Promise<MongoClient> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

export async function getMongoDb(): Promise<Db> {
  if (!uri) {
    throw new Error('Missing MONGODB_URI');
  }

  let clientPromise: Promise<MongoClient>;
  if (process.env.NODE_ENV === 'development') {
    if (!global.__mongoClientPromise) {
      global.__mongoClientPromise = new MongoClient(uri).connect();
    }
    clientPromise = global.__mongoClientPromise!;
  } else {
    if (!prodClientPromise) {
      prodClientPromise = new MongoClient(uri).connect();
    }
    clientPromise = prodClientPromise!;
  }

  const client = await clientPromise;
  return client.db(dbName);
}
