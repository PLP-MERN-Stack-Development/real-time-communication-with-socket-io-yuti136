const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  jwtSecret: process.env.JWT_SECRET || "dev_secret_change_me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
};
