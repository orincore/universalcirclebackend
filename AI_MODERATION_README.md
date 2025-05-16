# AI Moderation System for Circle App

This system uses Google's Gemini AI to automatically analyze and moderate reported content in the Circle app.

## Features

- **Automatic Message Analysis**: Scans reported messages for inappropriate content
- **User History Evaluation**: Considers a user's history of reports when making decisions
- **Auto-Banning**: Can automatically ban users with repeated violations
- **Activity Tracking**: Records all AI decisions in the admin activity log
- **Smart Handling**: Routes complex cases to human moderators when needed

## How It Works

1. When a user reports a message, the system automatically analyzes it using Gemini AI
2. The AI classifies the message as:
   - INAPPROPRIATE: Content that violates platform guidelines
   - BORDERLINE: Content that may be inappropriate but requires human judgment
   - ACCEPTABLE: Content that doesn't violate guidelines
3. If the content is inappropriate, the system checks the user's report history
4. Based on the severity and pattern of violations, the AI can:
   - Ban the user (for 7 days, 30 days, or permanently)
   - Issue a warning
   - Take no action (for false reports)
5. All decisions are logged in the admin activity log with "Gemini AI" as the moderator

## Setup

1. Ensure your `.env` file has the following variables:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   AI_MODERATION_ENABLED=true
   AI_PROCESSING_MODE=direct
   ```

2. For webhook-based processing (optional), add:
   ```
   WEBHOOK_SECRET=your_secure_secret
   WEBHOOK_BASE_URL=https://your-api-url.com
   ```

## Processing Modes

- **Direct Mode** (`AI_PROCESSING_MODE=direct`): Processes reports in the same server process
- **Webhook Mode** (`AI_PROCESSING_MODE=webhook`): Sends reports to a webhook endpoint for processing

## Admin Panel Integration

The AI moderation results appear in the admin panel:

1. In the Reports section, AI-resolved reports show "Resolved by Gemini AI" 
2. The Recent Activity feed shows all AI actions
3. Admin users can override AI decisions if needed

## Testing

To test the system:
1. Submit a report for a message
2. The report will be automatically processed if `AI_MODERATION_ENABLED=true`
3. Check the admin panel to see the AI's decision and explanation 