const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const { Sequelize } = require("sequelize");
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

/**
 * Gets unpaid jobs for client or contractor
 *
 * @returns {Job[]} jobs
 */
app.get("/jobs/unpaid", getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get("models");

  const clause = req.profile.type === "client" ? "ClientId" : "ContractorId";

  const contracts = await Contract.findAll({
    where: {
      status: "in_progress",
      [clause]: req.profile.id,
    },
  });

  const unpaidJobsPromises = contracts.map(async (contract) => {
    const unpaidJob = await Job.findAll({
      where: {
        ContractId: contract.id,
        paid: false || null,
      },
    });

    return unpaidJob;
  });

  const unpaidJobsList = await Promise.all(unpaidJobsPromises);

  return res.status(200).json(unpaidJobsList.flat());
});

/**
 * Pays a contractor for a job
 *
 * @returns Success message
 */
app.post("/jobs/:job_id/pay", getProfile, async (req, res) => {
  if (req.profile.type !== "client") return res.status(404).end();

  const jobId = req.params.job_id;
  const { Job, Contract, Profile } = req.app.get("models");

  const job = await Job.findOne({
    where: {
      id: jobId,
    },
  });

  if (!job) return res.status(400).json({ error: "Job not found" });

  const { price, ContractId } = job;
  const contract = await Contract.findOne({
    where: { id: ContractId },
  });

  if (!contract) return res.status(400).json({ error: "Contract not found" }); // pretty bad if this happens

  const { balance } = req.profile;

  if (price > balance)
    return res
      .status(400)
      .send({ error: "Insufficient balance to complete transaction" });

  const { ContractorId } = contract;
  const contractor = await Profile.findOne({
    where: {
      id: ContractorId,
    },
  });

  if (!contractor)
    return res.status(400).json({ error: "Contractor not found" }); // this is even worse

  const { balance: contractorBalance } = contractor;

  const finalClientBalance = balance - price;
  const finalContractorBalance = balance + price;

  try {
    await sequelize.transaction(async (transaction) => {
      await req.profile.changed("balance", finalClientBalance);
      await req.profile.save({ transaction });

      await contractor.changed("balance", finalContractorBalance);
      await contractor.save({ transaction });
    });
  } catch (error) {
    return res.status(400).send(error);
  }

  // Note: we don't necessarily mark the job as complete, do we? in assume a job can be paid for but not completed as it could be a recurring job or something more long-term

  return res.status(200).json({
    success: true,
  });
});

module.exports = app;
