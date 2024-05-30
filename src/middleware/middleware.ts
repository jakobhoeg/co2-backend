import jwt from "jsonwebtoken";

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

export { authenticateUser, authenticateAdmin };
