import { routes } from "./routes/routes.js";
import { configDotenv } from "dotenv";
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
