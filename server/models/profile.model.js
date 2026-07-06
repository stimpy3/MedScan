// server/models/profile.model.js
// One member health profile (Netflix model: an account owns several).
// Field set mirrors the guest-mode AsyncStorage shape in app/services/profileService.js
// so the signup merge is field-for-field.
const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
  label: { type: String, required: true, trim: true },
  relation: { type: String, enum: ["self", "mother", "father", "spouse", "child", "other"], default: "self" },
  ageYears: { type: Number, default: null },
  gender: { type: String, enum: ["male", "female", "other", null], default: null },
  pregnant: { type: Boolean, default: false },
  breastfeeding: { type: Boolean, default: false },
  allergies: { type: [String], default: [] },
  conditions: { type: [String], default: [] },
  alcohol: { type: String, enum: ["none", "occasional", "regular", null], default: null },
  otherMedicines: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

profileSchema.pre("save", function (next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model("Profile", profileSchema);
