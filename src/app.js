const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const { Sequelize } = require("sequelize");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

/**
 * Gets the current logged in client's profile
 *
 * @returns {Profile}
 */
app.get("/profile", getProfile, (req, res) => {
  return res.status(200).json(req.profile);
});

/**
 * FIX ME!
 * @returns contract by id
 */
app.get("/contracts/:id", getProfile, async (req, res) => {
  const { Contract, Profile } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findOne({ where: { id } });
  if (!contract) return res.status(404).end();
  res.json(contract);
});

/**
 * gets all contractors for a client
 *
 * @returns {Profile[]} Profiles
 */
app.get("/client/contracts", getProfile, async (req, res) => {
  const { Contract, Profile } = req.app.get("models");

  const contracts = await Contract.findAll({
    where: {
      ClientId: req.profile.id,
    },
  });

  if (contracts.length === 0) {
    return res.status(404).json({
      error: "No contracts found",
    });
  }

  const profileIds = contracts.map((contract) => contract.ContractorId);
  const uniqueIds = [];
  profileIds.forEach((profileId) => {
    if (uniqueIds.indexOf(profileId) === -1) {
      uniqueIds.push(profileId);
    }
  });

  const profileIdPromises = uniqueIds.map(async (id) => {
    const profile = await Profile.findOne({
      where: {
        id,
      },
    });

    return profile;
  });

  const profiles = await Promise.all(profileIdPromises);

  return res.status(200).json(profiles);
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

  return res.status(200).json(profiles);
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
      await Profile.update(
        {
          balance: finalClientBalance,
        },
        {
          where: {
            id: req.profile.id,
          },
          transaction,
        }
      );

      await Profile.update(
        {
          balance: finalContractorBalance,
        },
        {
          where: {
            id: ContractorId,
          },
          transaction,
        }
      );
    });
  } catch (error) {
    return res.status(400).send(error);
  }

  // Note: we don't necessarily mark the job as complete, do we? i assume a job can be paid for but not completed as it could be a recurring job or something more long-term

  return res.status(200).json({
    success: true,
  });
});

/**
 * Deposits the passed amount to the logged in client profile
 *
 * @returns success
 */
app.post("/balances/deposit/:userId", getProfile, async (req, res) => {
  // Note: this assumes that we're paying into the balance of the user that's logged in; in this case, `userId` is redundant as the context of the current user can be inferred from `res` as `id` (since we're not really tracking the identity of the actual user that's using the interface)

  if (req.profile.type !== "client") return res.status(404).end();

  const { Job, Contract, Profile } = req.app.get("models");
  const amount = req.body.amount;

  if (!amount || amount <= 0)
    return res.status(400).json({
      error: "Invalid amount to deposit",
    });

  const contracts = await Contract.findAll({
    where: {
      ClientId: req.profile.id,
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

  let totalPending = 0;

  unpaidJobsList.flat().forEach((job) => {
    totalPending += job.price;
  });

  if (amount >= totalPending * 0.25) {
    return res
      .status(400)
      .json({ error: "Amount higher than permitted limit" });
  }

  const finalBalance = req.profile.balance + amount;

  await Profile.update(
    {
      balance: finalBalance,
    },
    {
      where: {
        id: req.profile.id,
      },
    }
  );

  return res.status(200).json({
    success: true,
  });
});

/**
 * Gets the profession that earned the most money in a timeframe
 */
app.get("/admin/best-profession", async (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  const { Job, Contract, Profile } = req.app.get("models");

  if (!start || !end) {
    return res.status(400).json({ error: "Invalid timeframe" });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  try {
    // ended up writing raw SQL as sequelize wasn't happy with the joins for some reason and I lost too much time working with this join
    const result = await sequelize.query(
      `
  SELECT
    "Profile"."profession",
    SUM("Jobs"."price") as "totalEarned"
  FROM
    "Profiles" as "Profile"
    INNER JOIN "Contracts" as "Contractor" ON "Profile"."id" = "Contractor"."ContractorId"
    INNER JOIN "Jobs" as "Jobs" ON "Contractor"."id" = "Jobs"."ContractId"
  WHERE
    "Profile"."type" = 'contractor'
    AND "Jobs"."paid" = true
    AND "Jobs"."paymentDate" >= :startDate
    AND "Jobs"."paymentDate" =< :endDate
  GROUP BY
    "Profile"."profession"
  ORDER BY
    "totalEarned" DESC
  LIMIT 1`,
      {
        replacements: { startDate, endDate },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const data = result[0];

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).send(error);
  }
});

/**
 * Gets the list of best clients in a timeframe
 */
app.get("/admin/best-clients", async (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  const limit = req.query.limit || 2;
  const { Job, Contract, Profile } = req.app.get("models");

  if (!start || !end) {
    return res.status(400).json({ error: "Invalid timeframe" });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  try {
    const result = await sequelize.query(
      `
    SELECT
    "Profile"."id",
    "Profile"."firstName",
    "Profile"."lastName",
    SUM("Jobs"."price") as "paid"
  FROM
    "Profiles" as "Profile"
    INNER JOIN "Contracts" as "Client" ON "Profile"."id" = "Client"."ClientId"
    INNER JOIN "Jobs" as "Jobs" ON "Client"."id" = "Jobs"."ContractId"
  WHERE
    "Profile"."type" = 'client'
    AND "Jobs"."paid" = true
    AND "Jobs"."paymentDate" >= :startDate
    AND "Jobs"."paymentDate" =< :endDate
  GROUP BY
    "Profile"."id", "Profile"."firstName", "Profile"."lastName", "Profile"."profession"
  ORDER BY
    "totalPaid" DESC
  LIMIT :limit`,
      {
        replacements: {
          startDate,
          endDate,
          limit,
        },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const formattedResponse = result.map((row) => {
      return {
        id: row.id,
        fullName: `${row.firstName} ${row.lastName}`,
        paid: row.paid,
      };
    });

    return res.status(200).json(formattedResponse);
  } catch (error) {
    return res.status(400).send(error);
  }
});

module.exports = app;
