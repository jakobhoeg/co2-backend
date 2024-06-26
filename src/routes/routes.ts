import cors from "cors";
import express from "express";
import bodyParser, { json } from "body-parser";
import { RedisClient } from "../sessions/db.js";
import { User } from "../models/user.js";
import bcrypt from "bcrypt";
import jwt, { JwtPayload } from "jsonwebtoken";
import { configDotenv } from "dotenv";
import {
  authenticateAdmin,
  authenticateDevice,
  authenticateUser,
  getSensorData,
} from "../middleware/middleware.js";
import { v4 as uuidv4 } from "uuid";
import strftime from "strftime";
import { getMessaging } from "firebase-admin/messaging";

//#region Setup

const routes = express();

configDotenv();

routes.use(cors());
routes.use(express.static("public"));

routes.use(bodyParser.urlencoded({ extended: false }));
routes.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET;
const BLACKLISTED_TOKEN_KEY = "blacklistedTokens";

//#endregion

//#region Endpoints

//#region Authentication

routes.post("/api/register", authenticateAdmin, async (req, res) => {
  const { email, password, name, institution } = req.body;

  if (!email || !password || !name || !institution) {
    return res.status(400).send("Missing required fields");
  }

  try {
    const userExists = await RedisClient.HEXISTS("user:" + email, "email");

    if (userExists) {
      res.status(409).send("User already exists");
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user: User = {
      id: uuidv4(),
      name,
      email,
      password: hashedPassword,
      institutionName: institution,
      isAdmin: false,
    };

    // Add the user with the hashed password to the Redis hash 'users'
    await RedisClient.HSET("user:" + user.email, {
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      institutionName: user.institutionName,
      isAdmin: user.isAdmin.toString(),
    });

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send("Error registering user");
  }
});

routes.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send("Missing required fields");
  }

  // Check if user exists by checking if the hash key exists
  const userExists = await RedisClient.HEXISTS("user:" + email, "password");

  if (!userExists) {
    res.status(403).send("User does not exist");
    return;
  }

  // Get the user from the Redis hash
  const user = await RedisClient.HGETALL("user:" + email);
  console.log(user);

  // Compare the hashed password with the password provided
  const passwordMatches = await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    res.status(403).send("Invalid email or password");
    return;
  }

  try {
    // Generate JWT token
    const token = jwt.sign({ user }, JWT_SECRET, {
      expiresIn: "1h",
    });
    const refreshToken = jwt.sign({ user }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set the refresh token as a cookie, access token as a header and send the user object
    res
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      })
      .header("Authorization", `Bearer ${token}`)
      .send({
        user,
        token: "Bearer " + token,
      });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).send("Error logging in");
  }
});

routes.post("/api/refresh", async (req, res) => {
  const refreshToken = req.headers.cookie;

  if (!refreshToken) {
    return res.status(403).send("Access Denied. No refresh token provided.");
  }

  // Check database to see if refresh token is blacklisted (logged out)
  const blacklisted = await RedisClient.SISMEMBER(
    BLACKLISTED_TOKEN_KEY,
    refreshToken
  );

  if (blacklisted) {
    return res.status(403).send("Access denied.");
  }

  const refreshTokenSplit = refreshToken.split("=")[1];

  try {
    const decoded = jwt.verify(refreshTokenSplit, JWT_SECRET) as JwtPayload;
    const accessToken = jwt.sign(
      { user: (decoded as { user: User }).user },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    res
      .header("Authorization", "Bearer " + accessToken)
      .status(200)
      .send({
        user: decoded.user,
        token: "Bearer " + accessToken,
      });
  } catch (error) {
    return res.status(403).send("Invalid refresh token.");
  }
});

routes.post("/api/logout", async (req, res) => {
  const refreshToken = req.headers.cookie;

  // Add the token to database as blacklisted
  await RedisClient.SADD(BLACKLISTED_TOKEN_KEY, refreshToken);

  res.clearCookie("refreshToken");
  res.setHeader("Authorization", "");
  res.status(200).send("User logged out successfully");
});

routes.post("/api/fcm", authenticateUser, async (req, res) => {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return res.status(400).send("FCM token not provided");
  }

  const user = req.user;

  try {
    await RedisClient.HSET("user:" + user.email, {
      fcmToken: fcmToken,
    });

    res.status(200).send("FCM token saved successfully");
  } catch (error) {
    console.error("Error saving FCM token:", error);
    res.status(500).send("Error saving FCM token");
  }
});

//#endregion

//#region Instution

// Endpoint for creating an institution
routes.post("/api/institution", authenticateAdmin, async (req, res) => {
  const { name, address, city, postalCode } = req.body;

  if (!name || !address || !city || !postalCode) {
    return res.status(400).send("Missing required fields");
  }

  try {
    const institutionId = uuidv4();

    const institution: Institution = {
      id: institutionId,
      name,
      address,
      city,
      postalCode,
    };

    await RedisClient.HSET("institution:" + institution.name, {
      id: institution.id,
      name: institution.name,
      address: institution.address,
      city: institution.city,
      postalCode: institution.postalCode,
    });

    res.status(201).json({ message: "Institution created successfully" });
  } catch (error) {
    console.error("Error creating institution:", error);
    res.status(500).send("Error creating institution");
  }
});

//#endregion

//#region Sensor

// Endpoint for creating a sensor
routes.post("/api/sensor", authenticateAdmin, async (req, res) => {
  const { serialNum, institutionName, roomName } = req.body;

  if (!serialNum || !institutionName || !roomName) {
    return res.status(400).send("Missing required fields");
  }

  try {
    const sensorId = uuidv4();

    const sensor: Sensor = {
      id: sensorId,
      serialNum,
      institutionName,
      roomName,
      timestamp: strftime("%Y-%m-%d %H:%M:%S", new Date()),
    };

    // Check if sensor already exists
    const sensorExists = await RedisClient.HEXISTS("sensor:" + serialNum, "id");

    if (sensorExists) {
      res.status(409).send("Sensor already exists");
      return;
    }

    // Check if institution does not exist
    const institutionExists = await RedisClient.HEXISTS(
      "institution:" + institutionName,
      "name"
    );

    if (!institutionExists) {
      res.status(404).send("Institution does not exist");
      return;
    }

    await RedisClient.HSET("sensor:" + serialNum, {
      id: sensorId,
      serialNum,
      institutionName,
      roomName,
      timestamp: sensor.timestamp,
    });

    // Initialize lists for sensor data
    const temperatureKey = `sensor:${serialNum}:temperatures`;
    const humidityKey = `sensor:${serialNum}:humidities`;
    const co2Key = `sensor:${serialNum}:co2`;
    const timestampKey = `sensor:${serialNum}:timestamps`;

    await RedisClient.RPUSH(temperatureKey, "0");
    await RedisClient.RPUSH(humidityKey, "0");
    await RedisClient.RPUSH(co2Key, "0");
    await RedisClient.RPUSH(timestampKey, sensor.timestamp);

    res.status(201).json({ message: "Sensor created successfully" });
  } catch (error) {
    console.error("Error creating sensor:", error);
    res.status(500).send("Error creating sensor");
  }
});

// Endpoint for getting sensor roomNames to display in frontend dropdown
routes.get("/api/sensor", authenticateUser, async (req, res) => {
  const user = req.user;

  const institutionName = user.institutionName;

  try {
    const data = await getSensorData(institutionName);

    // return only roomName
    const sensors = data.sensors.map((sensor) => {
      return {
        roomName: sensor.roomName,
      };
    });

    res.status(200).json(sensors);
  } catch (error) {
    console.error("Error getting sensors:", error);
    res.status(500).send("Error getting sensors");
  }
});

// DELETE: Endpoint for deleting a sensor
routes.delete("/api/sensor/:serialNum", authenticateAdmin, async (req, res) => {
  const serialNum = req.params.serialNum;

  if (!serialNum) {
    return res.status(400).send("Missing required fields");
  }

  try {
    console.log("Received serialNum for deletion:", serialNum);

    const sensorExists = await RedisClient.HEXISTS("sensor:" + serialNum, "id");

    console.log(`Sensor exists check for ${serialNum}:`, sensorExists);

    if (!sensorExists) {
      return res.status(404).send("Sensor not found");
    }

    // Delete the sensor key
    await RedisClient.DEL("sensor:" + serialNum);

    console.log(`Sensor key deleted for ${serialNum}`);

    const temperatureKey = `sensor:${serialNum}:temperatures`;
    const humidityKey = `sensor:${serialNum}:humidities`;
    const co2Key = `sensor:${serialNum}:co2`;
    const timestampKey = `sensor:${serialNum}:timestamps`;

    await RedisClient.DEL(temperatureKey);
    await RedisClient.DEL(humidityKey);
    await RedisClient.DEL(co2Key);
    await RedisClient.DEL(timestampKey);

    console.log(`Related data keys deleted for ${serialNum}`);

    res.status(200).json({ message: "Sensor deleted successfully" });
  } catch (error) {
    console.error("Error deleting sensor:", error);
    res.status(500).send("Error deleting sensor");
  }
});

// Endpoint for sending sensor data
routes.put("/api/sensor/data", authenticateDevice, async (req, res) => {
  const { serialNum, temperature, humidity, co2, timestamp } = req.body;

  if (!serialNum || !temperature || !humidity || !co2 || !timestamp) {
    return res.status(400).send("Missing required fields");
  }

  try {
    // Check if sensor exists
    const sensorExists = await RedisClient.HEXISTS(
      "sensor:" + serialNum,
      "serialNum"
    );

    if (!sensorExists) {
      res.status(404).send("Sensor does not exist");
      return;
    }

    // Append data to respective lists
    const temperatureKey = `sensor:${serialNum}:temperatures`;
    const humidityKey = `sensor:${serialNum}:humidities`;
    const co2Key = `sensor:${serialNum}:co2`;
    const timestampKey = `sensor:${serialNum}:timestamps`;

    await RedisClient.RPUSH(temperatureKey, String(temperature));
    await RedisClient.RPUSH(humidityKey, String(humidity));
    await RedisClient.RPUSH(co2Key, String(co2));
    await RedisClient.RPUSH(timestampKey, timestamp);

    // Check if CO2 level is above 1000 ppm and send a push notification to all users in the institution (this is just a proof of concept)
    if (co2 > 1000) {
      // Find the sensor's institution
      const sensor = await RedisClient.HGETALL("sensor:" + serialNum);
      const institutionName = sensor.institutionName;

      // Find all users with the same institution
      const users = await RedisClient.KEYS("user:*");
      const usersWithSameInstitution = [];

      for (const userKey of users) {
        const user = await RedisClient.HGETALL(userKey);
        if (user.institutionName === institutionName) {
          usersWithSameInstitution.push(user);
        }
      }

      // Get the FCM tokens of the users
      const fcmTokens = usersWithSameInstitution
        .map((user) => user.fcmToken)
        .filter((token) => token); // Filter out users without FCM tokens

      // Send push notifications to the users
      for (const fcmToken of fcmTokens) {
        const message = {
          notification: {
            title: "Højt CO2-niveau",
            body: "CO2 niveauet er over 1000 ppm for " + sensor.roomName,
          },
          token: fcmToken,
        };

        getMessaging()
          .send(message)
          .then((response) => {
            // Response is a message ID string.
            console.log("Successfully sent message:", response);
          })
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
    }

    res.status(201).json({ message: "Sensor data sent successfully" });
  } catch (error) {
    console.error("Error sending sensor data:", error);
    res.status(500).send("Error sending sensor data");
  }
});

// GET: Endpoint for getting sensor data from the logged in user's institution
routes.get("/api/sensor/data", authenticateUser, async (req, res) => {
  const user = req.user;

  console.log(user);

  const institutionName = user.institutionName;
  console.log(institutionName);

  try {
    const data = await getSensorData(institutionName);
    res.status(200).json(data);
  } catch (error) {
    console.error("Error getting sensor data:", error);
    res.status(500).send("Error getting sensor data");
  }
});

// GET: Endpoint for getting all sensor data from a specific sensor in query params
routes.get("/api/sensor/data/:roomName", authenticateUser, async (req, res) => {
  const user = req.user;

  const institutionName = user.institutionName;
  const roomName = req.params.roomName.substring(1);
  console.log(roomName);

  try {
    const data = await getSensorData(institutionName, roomName);

    res.status(200).json(data);
  } catch (error) {
    console.error("Error getting sensor data:", error);
    res.status(500).send("Error getting sensor data");
  }
});

routes.get(
  "/api/sensor/data/hours/:hours",
  authenticateUser,
  async (req, res) => {
    const user = req.user;
    const institutionName = user.institutionName;
    const hours = parseInt(req.params.hours);

    try {
      const data = await getSensorData(institutionName, null, hours, null);
      res.status(200).json(data);
    } catch (error) {
      console.error("Error getting sensor data:", error);
      res.status(500).send("Error getting sensor data");
    }
  }
);

routes.get(
  "/api/sensor/data/days/:days",
  authenticateUser,
  async (req, res) => {
    const user = req.user;
    const institutionName = user.institutionName;
    const days = parseInt(req.params.days);

    try {
      const data = await getSensorData(institutionName, null, null, days);
      res.status(200).json(data);
    } catch (error) {
      console.error("Error getting sensor data:", error);
      res.status(500).send("Error getting sensor data");
    }
  }
);

//#endregion

//#endregion

export { routes };
