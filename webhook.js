// webhook.js (CommonJS version - fully compatible)
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

// Your GitHub webhook secret (set the same in GitHub webhook)
const WEBHOOK_SECRET = "orincore";

// Configure logging
const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFile = path.join(LOG_DIR, "webhook.log");
const logger = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.log(message);
};

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
      logger("❌ Signature mismatch");
      return res.status(401).send("Invalid signature");
    }
  }

  logger("✅ GitHub push event received");

  // Use sequential commands to handle potential conflicts better
  const commands = [
    "cd ~/universalcirclebackend",
    // Stash any local changes to avoid conflicts
    "git stash",
    // Fetch latest changes
    "git fetch origin main",
    // Use --no-rebase to merge instead of rebasing (safer for conflicts)
    "git pull --no-rebase origin main",
    // Check if there are merge conflicts
    "if [ $(git ls-files -u | wc -l) -gt 0 ]; then echo 'MERGE_CONFLICT'; else echo 'NO_CONFLICT'; fi",
    // Install dependencies
    "npm install",
    // Restart the app
    "pm2 restart all"
  ].join(" && ");

  exec(commands, (err, stdout, stderr) => {
    if (err) {
      logger(`❌ Deployment failed: ${err.message}`);
      logger(`Error details: ${stderr}`);
      
      // Check if the failure was due to merge conflicts
      if (stdout.includes("MERGE_CONFLICT")) {
        logger("⚠️ Merge conflicts detected. Deployment stopped to prevent data loss.");
        logger("Manual intervention required to resolve conflicts.");
        
        // You could send notifications here about the conflict
        
        // Abort the merge to leave the repository in a clean state
        exec("cd ~/universalcirclebackend && git merge --abort", (abortErr) => {
          if (abortErr) {
            logger(`❌ Failed to abort merge: ${abortErr.message}`);
          } else {
            logger("✅ Merge aborted successfully. Repository is in clean state.");
          }
        });
        
        return res.status(500).send("Deployment failed: Merge conflicts detected");
      }
      
      return res.status(500).send("Deployment failed: " + err.message);
    }
    
    logger("✅ Deployment successful");
    logger(stdout);
    res.status(200).send("Updated and restarted");
  });
});

app.listen(PORT, () => {
  logger(`🚀 Webhook server running on port ${PORT}`);
});
