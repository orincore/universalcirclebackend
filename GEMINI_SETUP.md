# Setting Up Gemini AI for Universal Circle

## API Key Setup Instructions

The Universal Circle platform uses Google's Gemini AI for content moderation and matchmaking. To ensure these features work correctly, follow these steps to set up your Gemini API key:

### Step 1: Create or Sign In to Google AI Studio

1. Go to [Google AI Studio](https://makersuite.google.com/)
2. Sign in with your Google account
3. Accept the terms of service

### Step 2: Get Your API Key

1. Click on "Get API key" in the top-right menu or go to [API Keys](https://makersuite.google.com/app/apikey)
2. Create a new API key and copy it
3. Keep this key secure - it has usage limits and should not be shared

### Step 3: Set Up in Universal Circle Backend

1. Add the API key to your `.env` file:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
2. Make sure you're using the **correct model name**:
   - Use `gemini-1.0-pro` instead of `gemini-pro`
   - The API endpoint should be `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro:generateContent`

### Step 4: Test the Connection

1. Restart your server after setting the API key
2. Monitor server logs for any Gemini API connection errors
3. Try testing a content moderation report to verify functionality

### Common Issues

- **404 Not Found Error**: Make sure you're using the correct model name (`gemini-1.0-pro`) and API endpoint path (`v1beta`)
- **API Key Invalid**: Verify your API key is correct and hasn't expired
- **Rate Limits**: Google applies usage limits to Gemini API keys. For production use, consider upgrading to a paid plan.

### Getting Help

If you continue to experience issues with Gemini AI integration, check:
1. [Google AI Official Documentation](https://ai.google.dev/docs)
2. [Gemini API Reference](https://ai.google.dev/api/rest/v1beta/models)
3. Contact the Universal Circle development team

Remember to never commit API keys to version control. Always use environment variables or secure storage solutions for keeping API keys confidential. 