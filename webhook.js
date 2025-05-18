// webhook.js (CommonJS version - fully compatible)
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { exec } = require("child_process");

const app = express();
const PORT = 3001;

// Your GitHub webhook secret (set the same in GitHub webhook)
const WEBHOOK_SECRET = "orincore";

// Raw body parser for GitHub signature validation
app.use(bodyParser.json({
  verify: function (req, res, buf) {
    req.rawBody = buf;
  }
}));

app.post("/github-webhook", (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  if (WEBHOOK_SECRET && signature) {
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    const digest = "sha256=" + hmac.update(req.rawBody).digest("hex");
    if (digest !== signature) {
      console.error("❌ Signature mismatch");
      return res.status(401).send("Invalid signature");
    }
  }

  console.log("✅ GitHub push event received");

  exec("cd ~/universalcirclebackend && git pull origin main && pm2 restart all", (err, stdout, stderr) => {
    if (err) {
      console.error("❌ Deployment failed:", stderr);
      return res.status(500).send("Deployment failed");
    }
    console.log("✅ Deployment successful:\n", stdout);
    res.status(200).send("Updated and restarted");
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
});
