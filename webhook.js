const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { exec } = require("child_process");

const app = express();
const PORT = 3001;

// Replace with the same secret you used in the GitHub webhook (if set)
const WEBHOOK_SECRET = "yourWebhookSecret";

app.use(bodyParser.json({
  verify: function (req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

app.post("/github-webhook", (req, res) => {
  // Validate signature
  const signature = req.headers["x-hub-signature-256"];
  if (WEBHOOK_SECRET && signature) {
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    const digest = "sha256=" + hmac.update(req.rawBody).digest("hex");
    if (signature !== digest) {
      return res.status(401).send("Signature mismatch");
    }
  }

  console.log("Received push event from GitHub");

  // Pull latest code and restart pm2
  exec("cd ~/universalcirclebackend && git pull origin main && pm2 restart all", (err, stdout, stderr) => {
    if (err) {
      console.error("Error executing update:", stderr);
      return res.status(500).send("Deployment failed");
    }
    console.log("Updated:\n", stdout);
    res.status(200).send("Updated and restarted");
  });
});

app.listen(PORT, () => {
  console.log(`GitHub webhook listener running on port ${PORT}`);
});
