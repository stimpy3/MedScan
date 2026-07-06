// server/routes/schedule.routes.js
// Authenticated CRUD for medicine reminders. Record shape mirrors the guest AsyncStorage records.
const express = require("express");
const Schedule = require("../models/schedule.model");
const Profile = require("../models/profile.model");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);

const SCHEDULE_FIELDS = ["medicineName", "medicineType", "dose", "days", "time", "instruction", "notes", "notificationEnabled"];

function toClient(s) {
  const out = { id: String(s._id), profileId: String(s.profileId) };
  for (const f of SCHEDULE_FIELDS) out[f] = s[f];
  out.createdAt = s.createdAt;
  return out;
}

function pickFields(body) {
  const out = {};
  for (const f of SCHEDULE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// List, optionally scoped to one member: GET /api/schedules?profileId=...
router.get("/", async (req, res) => {
  try {
    const query = { accountId: req.accountId };
    if (req.query.profileId) query.profileId = req.query.profileId;
    const schedules = await Schedule.find(query).sort({ createdAt: 1 });
    res.json({ schedules: schedules.map(toClient) });
  } catch (err) {
    console.error("[Schedules] list failed:", err.message);
    res.status(500).json({ error: "Could not load schedules" });
  }
});

router.post("/", async (req, res) => {
  try {
    const fields = pickFields(req.body);
    if (!String(fields.medicineName || "").trim()) return res.status(400).json({ error: "medicineName is required" });
    const profile = await Profile.findOne({ _id: req.body.profileId, accountId: req.accountId });
    if (!profile) return res.status(400).json({ error: "profileId must be one of your profiles" });
    const schedule = await Schedule.create({ ...fields, accountId: req.accountId, profileId: profile._id });
    res.json({ schedule: toClient(schedule) });
  } catch (err) {
    console.error("[Schedules] create failed:", err.message);
    res.status(500).json({ error: "Could not create schedule" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, accountId: req.accountId });
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    Object.assign(schedule, pickFields(req.body));
    await schedule.save();
    res.json({ schedule: toClient(schedule) });
  } catch (err) {
    console.error("[Schedules] update failed:", err.message);
    res.status(500).json({ error: "Could not update schedule" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Schedule.findOneAndDelete({ _id: req.params.id, accountId: req.accountId });
    if (!deleted) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Schedules] delete failed:", err.message);
    res.status(500).json({ error: "Could not delete schedule" });
  }
});

module.exports = router;
