// server/middleware/auth.middleware.js
// Bearer-JWT guard for account routes. Guest mode never hits these routes, so a missing
// token is simply a 401 — the client falls back to local storage.
const jwt = require("jsonwebtoken");
const { isDbReady } = require("../config/db");

function requireAuth(req, res, next) {
  if (!isDbReady()) return res.status(503).json({ error: "Account features are temporarily unavailable" });
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(503).json({ error: "Auth is not configured on this server" });

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  try {
    const payload = jwt.verify(token, secret);
    req.accountId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
