import { configDotenv } from "dotenv";
import jwt, { JwtPayload } from "jsonwebtoken";
import crypto from "crypto";
import { RedisClient } from "../sessions/db.js";

configDotenv();

const DEVICE_SECRET = process.env.DEVICE_SECRET;
const BLACKLISTED_TOKEN_KEY = "blacklistedTokens";

// Function to authenticate a JSON Web Token. It returns the decoded user if the token is valid.
const authenticateUser = async (req, res, next) => {
  const token = req.header("Authorization");
  const refreshToken = req.headers.cookie;

  if (!token && !refreshToken) {
    return res.status(403).send("Access denied.");
  }

  const tokenWithoutBearer = token.split(" ")[1];

  try {
    const decoded = jwt.verify(
      tokenWithoutBearer,
      process.env.JWT_SECRET
    ) as JwtPayload;
    req.user = decoded.user;
    console.log(req.user);
    next();
  } catch (ex) {
    if (!refreshToken) {
      return res.status(400).send("Invalid token.");
    }

    const refreshTokenSplit = req.headers.cookie.split("=")[1];

    // Check database for blacklisted refresh tokens
    const blacklisted = await RedisClient.SISMEMBER(
      BLACKLISTED_TOKEN_KEY,
      refreshToken
    );

    if (blacklisted) {
      return res.status(403).send("Access denied.");
    }

    // Verify the refresh token and send 401 because the access token is expired
    // to indicate that the user needs to get a new access token
    try {
      const decoded = jwt.verify(refreshTokenSplit, process.env.JWT_SECRET);

      res
        .cookie("refreshToken", refreshTokenSplit, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
        })
        .status(401)
        .send("Access token expired.");
    } catch (ex) {
      console.error("Error verifying refresh token:", ex);
      res.status(400).send("Invalid token.");
    }
  }
};

const authenticateAdmin = async (req, res, next) => {
  const token = req.header("Authorization");
  const refreshToken = req.headers.cookie;

  if (!token && !refreshToken) {
    return res.status(403).send("Access denied.");
  }

  const tokenWithoutBearer = token.split(" ")[1];

  try {
    const decoded = jwt.verify(
      tokenWithoutBearer,
      process.env.JWT_SECRET
    ) as JwtPayload;
    req.user = decoded.user;

    if (!req.user.isAdmin) {
      return res.status(403).send("Access denied.");
    }

    next();
  } catch (ex) {
    if (!refreshToken) {
      return res.status(400).send("Invalid token.");
    }

    const refreshTokenSplit = req.headers.cookie.split("=")[1];

    // Check database for blacklisted refresh tokens
    const blacklisted = await RedisClient.SISMEMBER(
      BLACKLISTED_TOKEN_KEY,
      refreshToken
    );

    if (blacklisted) {
      return res.status(403).send("Access denied.");
    }

    // Verify the refresh token and send 401 because the access token is expired
    // to indicate that the user needs to get a new access token
    try {
      const decoded = jwt.verify(refreshTokenSplit, process.env.JWT_SECRET);

      res
        .cookie("refreshToken", refreshTokenSplit, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
        })
        .status(401)
        .send("Access token expired.");
    } catch (ex) {
      console.error("Error verifying refresh token:", ex);
      res.status(400).send("Invalid token.");
    }
  }
};

const authenticateDevice = async (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(403).send("Access denied.");
  }

  const tokenWithoutBearer = token.split(" ")[1];
  const [timestamp, signature] = tokenWithoutBearer.split(":");

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const timeDifference = currentTimestamp - parseInt(timestamp);

  // Check if the token is older than 5 minutes
  if (timeDifference > 300) {
    return res.status(403).send("Token expired.");
  }

  const { serialNum } = req.body;

  // Check if the serial number exists in the database
  const sensorExists = await RedisClient.HEXISTS(
    "sensor:" + serialNum,
    "serialNum"
  );

  if (!sensorExists) {
    return res.status(404).send("Sensor does not exist.");
  }

  const message = serialNum + timestamp;
  const expectedSignature = crypto
    .createHmac("sha256", DEVICE_SECRET)
    .update(message)
    .digest("hex");

  if (signature === expectedSignature) {
    next();
  } else {
    res.status(403).send("Invalid token.");
  }
};

const getSensorData = async (
  institutionName,
  roomName = null,
  hours = null,
  days = null
) => {
  try {
    const sensors = await RedisClient.KEYS("sensor:*");
    const sensorsExtracted = sensors.map((sensor) => sensor.split(":")[1]);

    const sensorData = [];
    const serialNums = [];

    for (const sensor of sensorsExtracted) {
      if (serialNums.includes(sensor)) {
        continue;
      }
      serialNums.push(sensor);
      const data = await RedisClient.HGETALL("sensor:" + sensor);
      sensorData.push(data);
    }

    const filteredSensorData = sensorData.filter((data) => {
      return (
        data.institutionName === institutionName &&
        (roomName === null || data.roomName === roomName)
      );
    });

    const now = Date.now();
    let timeLimit = null;

    if (hours !== null) {
      timeLimit = hours * 3600 * 1000;
    } else if (days !== null) {
      timeLimit = days * 24 * 3600 * 1000;
    }

    for (const sensor of filteredSensorData) {
      const temperatureKey = `sensor:${sensor.serialNum}:temperatures`;
      const humidityKey = `sensor:${sensor.serialNum}:humidities`;
      const co2Key = `sensor:${sensor.serialNum}:co2`;
      const timestampKey = `sensor:${sensor.serialNum}:timestamps`;

      const temperatures = await RedisClient.LRANGE(temperatureKey, 0, -1);
      const humidities = await RedisClient.LRANGE(humidityKey, 0, -1);
      const co2 = await RedisClient.LRANGE(co2Key, 0, -1);
      const timestamps = await RedisClient.LRANGE(timestampKey, 0, -1);

      // Filter data based on time limit
      if (timeLimit !== null) {
        const filteredTemperatures = [];
        const filteredHumidities = [];
        const filteredCo2 = [];
        const filteredTimestamps = [];

        // Loop through each timestamp and check if it is within the time limit
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = new Date(timestamps[i]).getTime();
          if (now - timestamp <= timeLimit) {
            filteredTemperatures.push(temperatures[i]);
            filteredHumidities.push(humidities[i]);
            filteredCo2.push(co2[i]);
            filteredTimestamps.push(timestamps[i]);
          }
        }

        sensor.temperatures = filteredTemperatures;
        sensor.humidities = filteredHumidities;
        sensor.co2 = filteredCo2;
        sensor.timestamps = filteredTimestamps;
      } else {
        // If no time limit is specified, return all data (this is for the endpoint that gets all data)
        sensor.temperatures = temperatures;
        sensor.humidities = humidities;
        sensor.co2 = co2;
        sensor.timestamps = timestamps;
      }
    }

    return { sensors: filteredSensorData };
  } catch (error) {
    console.error("Error getting sensor data:", error);
    throw new Error("Error getting sensor data");
  }
};

export {
  authenticateUser,
  authenticateAdmin,
  authenticateDevice,
  getSensorData,
};
