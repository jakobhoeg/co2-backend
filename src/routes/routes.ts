import cors from "cors";
import express from "express";
import bodyParser, { json } from "body-parser";
import { RedisClient } from "../sessions/db.js";
import { User } from "../models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import {
  authenticateAdmin,
  authenticateDevice,
  authenticateUser,
  getSensorData,
} from "../middleware/middleware.js";
import { v4 as uuidv4 } from "uuid";
import strftime from "strftime";

//#region Setup

const routes = express();

configDotenv();

routes.use(cors());
routes.use(express.static("public"));

routes.use(bodyParser.urlencoded({ extended: false }));
routes.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET;

//#endregion

//#region Endpoints

//#region Authentication

// TODO: Delete this later after testing
routes.post("/api/register/admin", async (req, res) => {
  const { email, password, name, institution } = req.body;

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
      isAdmin: true,
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

    res.status(201).json({ message: "Admin registered successfully" });
  } catch (error) {
    console.error("Error registering admin:", error);
    res.status(500).send("Error registering admin");
  }
});

routes.post("/api/register", authenticateAdmin, async (req, res) => {
  const { email, password, name, institution } = req.body;

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

  try {
    // Check if user exists by checking if the hash key exists
    const userExists = await RedisClient.HEXISTS("user:" + email, "password");

    if (userExists) {
      // Get the user from the Redis hash
      const user = await RedisClient.HGETALL("user:" + email);
      console.log(user);

      // Compare the hashed password with the password provided
      const passwordMatches = await bcrypt.compare(password, user.password);

      if (passwordMatches) {
        // Generate JWT token
        const token = jwt.sign({ user }, JWT_SECRET, {
          expiresIn: "1h",
        });

        // Set the token in the response header
        res.setHeader("Authorization", `Bearer ${token}`);
        // Set the token in a cookie
        res.cookie("token", token, { httpOnly: true });
        return res.status(200).json({
          message: "User logged in successfully",
          token: "Bearer " + token,
        });
      } else {
        res.status(401).send("Invalid email or password");
      }
    } else {
      res.status(401).send("User does not exist");
    }
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).send("Error logging in user");
  }
});

routes.post("/api/logout", authenticateUser, async (req, res) => {
  res.clearCookie("token");
  res.setHeader("Authorization", "");
  res.status(200).send("User logged out successfully");
});

//#endregion

//#region Instution

// Endpoint for creating an institution
routes.post("/api/institution", authenticateAdmin, async (req, res) => {
  const { name, address, city, postalCode } = req.body;

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

//#endregion

//#endregion

export { routes };
