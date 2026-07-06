// server/models/account.model.js
const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Which member profile was last active on this account (mirrors the guest-mode activeProfileId).
  activeProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Account", accountSchema);
