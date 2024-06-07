import { routes } from "./routes/routes.js";
import { configDotenv } from "dotenv";
import cron from "node-cron";
import strftime from "strftime";
import { RedisClient } from "./sessions/db.js";

configDotenv();

// Ensure that the port is always a number by parsing it
const port = parseInt(process.env.PORT);

if (process.env.NODE_ENV === "development") {
  routes.listen(port, "localhost", () => {
    console.log(`This server is listening at http://localhost:${port}`);
  });
} else {
  routes.listen(port, "0.0.0.0", () => {
    console.log(`This server is listening at http://0.0.0.0:${port}`);
  });
}

// Function to be used as a cron job to check and delete data older than 1 month
async function checkAndDeleteOldData() {
  const now = new Date();
  const oneMonthAgo = new Date(now.setMonth(now.getMonth() - 1));
  const formattedOneMonthAgo = strftime("%Y-%m-%d %H:%M:%S", oneMonthAgo);

  try {
    // Fetch all keys related to sensors
    const sensorKeys = await RedisClient.keys("sensor:*:timestamps");

    for (const key of sensorKeys) {
      // Get all timestamps from the sensor
      const timestamps = await RedisClient.LRANGE(key, 0, -1);

      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];

        if (timestamp < formattedOneMonthAgo) {
          // Delete the corresponding temperature, humidity, and CO2 values
          const sensorSerialNum = key.split(":")[1];

          const temperatureKey = `sensor:${sensorSerialNum}:temperatures`;
          const humidityKey = `sensor:${sensorSerialNum}:humidities`;
          const co2Key = `sensor:${sensorSerialNum}:co2`;
          const timestampKey = `sensor:${sensorSerialNum}:timestamps`;

          // Get the temperature, humidity, and CO2 values
          const temperature = await RedisClient.LINDEX(temperatureKey, i);
          const humidity = await RedisClient.LINDEX(humidityKey, i);
          const co2 = await RedisClient.LINDEX(co2Key, i);

          // Remove the values from the list
          await RedisClient.LREM(temperatureKey, 1, temperature);
          await RedisClient.LREM(humidityKey, 1, humidity);
          await RedisClient.LREM(co2Key, 1, co2);
          await RedisClient.LREM(timestampKey, 1, timestamp);
        }
      }
    }

    console.log("Old data checked and cleaned up successfully.");
  } catch (error) {
    console.error("Error checking and deleting old data:", error);
  }
}

// Schedule the cron job to run at 00:00 on the 1st day of every month
cron.schedule("0 0 1 * *", checkAndDeleteOldData);
