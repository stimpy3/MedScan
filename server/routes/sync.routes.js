// server/routes/sync.routes.js
// One-time guest→account merge. After signup/login the client uploads its local AsyncStorage
// document ({ profiles, schedules, activeProfileId } with local string ids); we recreate it
// under the account and return the full server state so the client can swap its cache to
// server ids. Idempotent-ish: profiles dedupe by label, schedules by (profile, name, time).
const express = require("express");
const Account = require("../models/account.model");
const Profile = require("../models/profile.model");
const Schedule = require("../models/schedule.model");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);

const PROFILE_FIELDS = ["label", "relation", "ageYears", "gender", "pregnant", "breastfeeding", "allergies", "conditions", "alcohol", "otherMedicines"];
const SCHEDULE_FIELDS = ["medicineName", "medicineType", "dose", "days", "time", "instruction", "notes", "notificationEnabled"];

const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
};

router.post("/merge", async (req, res) => {
  try {
    const localProfiles = Array.isArray(req.body.profiles) ? req.body.profiles : [];
    const localSchedules = Array.isArray(req.body.schedules) ? req.body.schedules : [];
    const localActiveId = req.body.activeProfileId || null;

    const existing = await Profile.find({ accountId: req.accountId });
    const byLabel = new Map(existing.map(p => [p.label.toLowerCase().trim(), p]));

    // 1. Profiles — local id → server profile (dedupe by label so re-running merge is safe).
    const idMap = new Map();
    for (const lp of localProfiles) {
      const label = String(lp.label || "").trim();
      if (!label) continue;
      let profile = byLabel.get(label.toLowerCase());
      if (!profile) {
        profile = await Profile.create({ ...pick(lp, PROFILE_FIELDS), accountId: req.accountId });
        byLabel.set(label.toLowerCase(), profile);
      }
      if (lp.id) idMap.set(String(lp.id), profile._id);
    }

    // 2. Schedules — remap profileId through the map; fall back to the first known profile.
    const fallbackProfile = byLabel.values().next().value || null;
    let importedSchedules = 0;
    for (const ls of localSchedules) {
      const name = String(ls.medicineName || "").trim();
      if (!name) continue;
      const profileId = idMap.get(String(ls.profileId)) || fallbackProfile?._id;
      if (!profileId) continue;
      const dupe = await Schedule.findOne({ accountId: req.accountId, profileId, medicineName: name, time: ls.time || "09:00" });
      if (dupe) continue;
      await Schedule.create({ ...pick(ls, SCHEDULE_FIELDS), accountId: req.accountId, profileId });
      importedSchedules++;
    }

    // 3. Active profile — honor the guest choice; otherwise ensure one is set.
    const account = await Account.findById(req.accountId);
    const mappedActive = localActiveId ? idMap.get(String(localActiveId)) : null;
    if (account && (mappedActive || !account.activeProfileId)) {
      account.activeProfileId = mappedActive || fallbackProfile?._id || account.activeProfileId;
      await account.save();
    }

    // 4. Return the full server state (client shapes) so the app swaps cleanly to server ids.
    const [profiles, schedules] = await Promise.all([
      Profile.find({ accountId: req.accountId }).sort({ createdAt: 1 }),
      Schedule.find({ accountId: req.accountId }).sort({ createdAt: 1 })
    ]);
    console.log(`[Sync] merged for ${req.accountId}: +${importedSchedules} schedule(s), ${profiles.length} profile(s) total`);
    res.json({
      activeProfileId: account?.activeProfileId ? String(account.activeProfileId) : null,
      profiles: profiles.map(p => {
        const out = { id: String(p._id) };
        for (const f of PROFILE_FIELDS) out[f] = p[f];
        out.createdAt = p.createdAt; out.updatedAt = p.updatedAt;
        return out;
      }),
      schedules: schedules.map(s => {
        const out = { id: String(s._id), profileId: String(s.profileId) };
        for (const f of SCHEDULE_FIELDS) out[f] = s[f];
        out.createdAt = s.createdAt;
        return out;
      })
    });
  } catch (err) {
    console.error("[Sync] merge failed:", err.message);
    res.status(500).json({ error: "Sync failed" });
  }
});

module.exports = router;
