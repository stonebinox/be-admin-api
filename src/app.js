const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const app = express();
app.use(bodyParser.json());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

/**
 * FIX ME!
 * @returns contract by id
 */
app.get("/contracts/:id", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findOne({ where: { id } });
  if (!contract) return res.status(404).end();
  res.json(contract);
});

/**
 * Gets all client profiles from our DB
 *
 * @returns {Profile[]} client profiles
 */
app.get("/profiles", async (req, res) => {
  const { Profile } = req.app.get("models");
  const { id } = req.params;
  const profiles = await Profile.findAll({ where: { type: "client" } });

  res.status(200).json(profiles);
});

module.exports = app;
