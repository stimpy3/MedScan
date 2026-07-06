// server/config/db.js
// MongoDB Atlas connection. Deliberately NON-FATAL: accounts/sync are an optional layer on top
// of guest mode — if MONGODB_URI is missing or Atlas is unreachable, the server still runs and
// every guest-mode feature (chat, safety checks, local profiles) keeps working. Auth routes
// check isDbReady() and return 503 instead of crashing.
const mongoose = require("mongoose");
const dns = require("dns");

let ready = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[DB] MONGODB_URI not set — account features disabled, guest mode unaffected");
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    // mongodb+srv URIs need a DNS SRV lookup, which some home-router/ISP resolvers refuse
    // (querySrv ECONNREFUSED). Retry once over public DNS — hosted environments (Render)
    // resolve fine on the first attempt and never reach this path.
    if (/querysrv/i.test(err.message) || err.code === "ECONNREFUSED") {
      console.warn("[DB] SRV lookup failed on system DNS — retrying via public DNS (8.8.8.8/1.1.1.1)");
      try {
        dns.setServers(["8.8.8.8", "1.1.1.1"]);
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      } catch (err2) {
        console.error("[DB] connection failed — account features disabled:", err2.message);
        return;
      }
    } else {
      console.error("[DB] connection failed — account features disabled:", err.message);
      return;
    }
  }
  ready = true;
  console.log("✅ MongoDB connected");
  mongoose.connection.on("disconnected", () => { ready = false; console.warn("[DB] disconnected"); });
  mongoose.connection.on("reconnected", () => { ready = true; console.log("[DB] reconnected"); });
}

const isDbReady = () => ready;

module.exports = { connectDB, isDbReady };
