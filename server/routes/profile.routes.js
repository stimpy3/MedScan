// server/routes/profile.routes.js
// Authenticated CRUD for member health profiles. Response shapes mirror the guest-mode
// AsyncStorage document ({ activeProfileId, profiles }) so the client services are symmetric.
const express = require("express");
const Account = require("../models/account.model");
const Profile = require("../models/profile.model");
const Schedule = require("../models/schedule.model");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);

const PROFILE_FIELDS = ["label", "relation", "ageYears", "gender", "pregnant", "breastfeeding", "allergies", "conditions", "alcohol", "otherMedicines"];

function toClient(p) {
  const out = { id: String(p._id) };
  for (const f of PROFILE_FIELDS) out[f] = p[f];
  out.createdAt = p.createdAt;
  out.updatedAt = p.updatedAt;
  return out;
}

function pickFields(body) {
  const out = {};
  for (const f of PROFILE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// Full state: { activeProfileId, profiles } — same shape as the guest document.
router.get("/", async (req, res) => {
  try {
    const [account, profiles] = await Promise.all([
      Account.findById(req.accountId),
      Profile.find({ accountId: req.accountId }).sort({ createdAt: 1 })
    ]);
    res.json({
      activeProfileId: account?.activeProfileId ? String(account.activeProfileId) : null,
      profiles: profiles.map(toClient)
    });
  } catch (err) {
    console.error("[Profiles] list failed:", err.message);
    res.status(500).json({ error: "Could not load profiles" });
  }
});

router.post("/", async (req, res) => {
  try {
    const fields = pickFields(req.body);
    if (!String(fields.label || "").trim()) return res.status(400).json({ error: "label is required" });
    const profile = await Profile.create({ ...fields, accountId: req.accountId });
    // First profile automatically becomes active (mirrors guest behavior).
    const account = await Account.findById(req.accountId);
    if (account && !account.activeProfileId) {
      account.activeProfileId = profile._id;
      await account.save();
    }
    res.json({ profile: toClient(profile) });
  } catch (err) {
    console.error("[Profiles] create failed:", err.message);
    res.status(500).json({ error: "Could not create profile" });
  }
});

router.put("/active/:id", async (req, res) => {
  try {
    const profile = await Profile.findOne({ _id: req.params.id, accountId: req.accountId });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    await Account.findByIdAndUpdate(req.accountId, { activeProfileId: profile._id });
    res.json({ activeProfileId: String(profile._id) });
  } catch (err) {
    console.error("[Profiles] set-active failed:", err.message);
    res.status(500).json({ error: "Could not set active profile" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const profile = await Profile.findOne({ _id: req.params.id, accountId: req.accountId });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    Object.assign(profile, pickFields(req.body));
    await profile.save();
    res.json({ profile: toClient(profile) });
  } catch (err) {
    console.error("[Profiles] update failed:", err.message);
    res.status(500).json({ error: "Could not update profile" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const profile = await Profile.findOneAndDelete({ _id: req.params.id, accountId: req.accountId });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const remaining = await Profile.find({ accountId: req.accountId }).sort({ createdAt: 1 });
    if (remaining.length) {
      // Mirror guest behavior: orphaned schedules move to the first remaining profile.
      await Schedule.updateMany({ accountId: req.accountId, profileId: profile._id }, { profileId: remaining[0]._id });
      const account = await Account.findById(req.accountId);
      if (account && String(account.activeProfileId) === String(profile._id)) {
        account.activeProfileId = remaining[0]._id;
        await account.save();
      }
    } else {
      await Schedule.deleteMany({ accountId: req.accountId, profileId: profile._id });
      await Account.findByIdAndUpdate(req.accountId, { activeProfileId: null });
    }
    res.json({ ok: true, activeProfileId: remaining.length ? undefined : null });
  } catch (err) {
    console.error("[Profiles] delete failed:", err.message);
    res.status(500).json({ error: "Could not delete profile" });
  }
});

module.exports = router;
