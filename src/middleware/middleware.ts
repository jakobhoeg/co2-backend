import { configDotenv } from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { RedisClient } from "../sessions/db.js";

configDotenv();

const DEVICE_SECRET = process.env.DEVICE_SECRET;

// Function to authenticate a JSON Web Token. It returns the decoded user email if the token is valid.
const authenticateUser = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).send("Access denied.");
  }

  const tokenWithoutBearer = token.split(" ")[1];

  try {
    const decoded = jwt.verify(tokenWithoutBearer, process.env.JWT_SECRET);
    req.user = decoded;
    console.log(req.user);
    next();
  } catch (ex) {
    res.status(400).send("Invalid token.");
  }
};

const authenticateAdmin = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).send("Access denied.");
  }

  const tokenWithoutBearer = token.split(" ")[1];

  try {
    const decoded = jwt.verify(tokenWithoutBearer, process.env.JWT_SECRET);
    req.user = decoded;
    console.log(req.user);

    // Check if the user is an admin
    if (req.user.user.isAdmin === "true") {
      next();
    } else {
      res.status(403).send("Access denied.");
    }
  } catch (ex) {
    res.status(400).send("Invalid token.");
  }
};

const authenticateDevice = async (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).send("Access denied.");
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

export { authenticateUser, authenticateAdmin, authenticateDevice };
