import cors from "cors";
import express from "express";
import bodyParser from "body-parser";
import { RedisClient } from "../sessions/db.js";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { User } from "../models/user.js";
import bcrypt from "bcrypt";

//#region Setup

const routes = express();

routes.use(cors());
routes.use(express.static("public"));

routes.use(bodyParser.urlencoded({ extended: false }));
routes.use(bodyParser.json());

//#endregion

//#region Endpoints

routes.post("/api/register", async (req, res) => {
  const { email, password } = req.body;

  const user: User = {
    email: email,
    password: password,
  };

  try {
    // Check if the email exists in the Redis set 'users'
    const userExists = await RedisClient.SISMEMBER("users", user.email);

    if (userExists) {
      res.status(409).send("User already exists");
      return;
    }

    // Add the email to the Redis set 'users'
    await RedisClient.SADD("users", user.email);
    // Bcrypt the password and store it in the Redis hash 'users'
    await RedisClient.HSET(
      "users",
      user.email,
      await bcrypt.hash(user.password, 10)
    );

    res.status(201).send("User registered successfully");
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send("Error registering user");
  }
});

routes.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user: User = {
    email: email,
    password: password,
  };

  try {
    // Check if the email exists in the Redis set 'users'
    const userExists = await RedisClient.SISMEMBER("users", user.email);

    if (userExists) {
      // Get the hashed password from the Redis hash 'users'
      const hashedPassword = await RedisClient.HGET("users", user.email);

      // Compare the hashed password with the password provided
      const passwordMatches = await bcrypt.compare(
        user.password,
        hashedPassword
      );

      if (passwordMatches) {
        res.status(200).send("User logged in successfully");
      } else {
        res.status(401).send("Invalid password");
      }
    } else {
      res.status(401).send("User not found");
    }
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).send("Error logging in user");
  }
});

//#endregion

export { routes };
