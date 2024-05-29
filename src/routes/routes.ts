import cors from "cors";
import express from "express";
import bodyParser, { json } from "body-parser";
import { RedisClient } from "../sessions/db.js";
import { User } from "../models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import authenticateJWT from "../middleware/middleware.js";
import { v4 as uuidv4 } from "uuid";

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

routes.post("/api/register", async (req, res) => {
  const { email, password, name } = req.body;
  console.log(email, password, name);

  try {
    const userExists = await RedisClient.HEXISTS("users", email);

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
      institute_id: "",
    };

    // Add the user with the hashed password to the Redis hash 'users'
    await RedisClient.HSET("users:", {
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      institute_id: user.institute_id,
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
    const userExists = await RedisClient.HEXISTS("users", email);

    if (userExists) {
      // Get the hashed password from the Redis hash 'users'
      const hashedPassword = await RedisClient.HGET("users", email);

      // Compare the hashed password with the password provided
      const passwordMatches = await bcrypt.compare(password, hashedPassword);

      if (passwordMatches) {
        // Generate JWT token
        const token = jwt.sign({ email }, JWT_SECRET, {
          expiresIn: "12h",
        });

        // Set the token in the response header
        res.setHeader("Authorization", `Bearer ${token}`);
        return res
          .status(200)
          .json({ message: "User logged in successfully", token });
      } else {
        res.status(401).send("Error logging in user");
      }
    } else {
      res.status(401).send("Error logging in user");
    }
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).send("Error logging in user");
  }
});

// Test route for protected route
routes.get("/api/protected", authenticateJWT, (req, res) => {
  res.send("This is a protected route.");
});

//#endregion

export { routes };
