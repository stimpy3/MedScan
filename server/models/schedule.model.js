// server/models/schedule.model.js
// A scheduled medicine reminder, owned by an account and attached to one member profile.
// Mirrors the guest-mode AsyncStorage record in app/services/scheduleService.js.
const mongoose = require("mongoose");

const scheduleSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: true, index: true },
  medicineName: { type: String, required: true, trim: true },
  medicineType: { type: String, default: "Pills" },
  dose: { type: String, default: "1" },
  days: { type: [Number], default: [] },        // 0=Mon … 6=Sun (client convention)
  time: { type: String, default: "09:00" },      // "HH:MM" 24h
  instruction: { type: String, default: "None" },
  notes: { type: String, default: "" },
  notificationEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Schedule", scheduleSchema);
