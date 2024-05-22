import redis from "redis";

// Create a client and connect to Redis server
const url = process.env.REDIS_URL;
const RedisClient = redis.createClient({
  url,
  legacyMode: true,
});

RedisClient.on("connect", () => console.log("Redis client connected"));
RedisClient.on("error", (err) => console.log("Redis Client Error", err));

RedisClient.connect();

export { RedisClient };
