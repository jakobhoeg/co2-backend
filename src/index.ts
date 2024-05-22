import { routes } from "./routes/routes.js";

// Ensure that the port is always a number by parsing it
const port = parseInt(process.env.PORT);

const server = routes.listen(port, "0.0.0.0", () => {
  console.log(`This server is listening at http://0.0.0.0:${port}`);
});
