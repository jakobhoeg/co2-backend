import redis from "redis";
import { configDotenv } from "dotenv";

// Create a client and connect to Redis server
configDotenv();
let url = "";

if (process.env.NODE_ENV === "development") {
  url = process.env.REDIS_DEV_URL;
} else {
  url = process.env.REDIS_URL;
}

const RedisClient = redis.createClient({
  url,
  socket: {
    connectTimeout: 10000, // Increase timeout to 10 seconds
  },
});

RedisClient.on("connect", () => console.log("Redis client connected"));
RedisClient.on("error", (err) => console.log("Redis Client Error", err));

RedisClient.connect();

export { RedisClient };
