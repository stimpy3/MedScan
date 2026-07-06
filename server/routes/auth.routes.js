// server/routes/auth.routes.js
// Email/password auth → JWT. Guest mode never touches these routes.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Account = require("../models/account.model");
const { isDbReady } = require("../config/db");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = "30d";

function signToken(accountId) {
  return jwt.sign({ sub: String(accountId) }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function guard(req, res) {
  if (!isDbReady()) { res.status(503).json({ error: "Account features are temporarily unavailable" }); return false; }
  if (!process.env.JWT_SECRET) { res.status(503).json({ error: "Auth is not configured on this server" }); return false; }
  return true;
}

router.post("/signup", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please enter a valid email" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await Account.findOne({ email });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const account = await Account.create({ email, passwordHash });
    console.log(`[Auth] signup: ${email}`);
    return res.json({ token: signToken(account._id), account: { id: String(account._id), email } });
  } catch (err) {
    console.error("[Auth] signup failed:", err.message);
    return res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/login", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");
    const account = await Account.findOne({ email });
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    console.log(`[Auth] login: ${email}`);
    return res.json({ token: signToken(account._id), account: { id: String(account._id), email } });
  } catch (err) {
    console.error("[Auth] login failed:", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
