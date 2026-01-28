import Redis from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client) return client;

  client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
  });

  client.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[redis] error", message);
  });

  return client;
}
