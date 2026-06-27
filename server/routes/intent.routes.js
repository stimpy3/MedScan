const express = require("express");
const router = express.Router();
const { handleClassify } = require("../controllers/intent.controller");

router.post("/classify", handleClassify);

module.exports = router;
