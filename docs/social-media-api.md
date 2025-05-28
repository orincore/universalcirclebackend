# Social Media Handles API

This document outlines the API endpoints and request formats for working with social media handles in user profiles.

## Available Social Media Platforms

The following social media platforms are supported:

- Instagram (`instagram_handle`)
- Twitter (`twitter_handle`)
- Spotify (`spotify_handle`)
- LinkedIn (`linkedin_handle`)

## Updating Social Media Handles

Social media handles can be updated using the profile update endpoint:

**Endpoint:** `PUT /api/profile`

**Authentication:** JWT token required in Authorization header

### Request Format

You can update any combination of social media handles:

```json
{
  "instagram_handle": "your_instagram_username",
  "twitter_handle": "your_twitter_handle",
  "spotify_handle": "your_spotify_username",
  "linkedin_handle": "your_linkedin_profile"
}
```

### Example Requests

**Update all social media handles:**

```json
{
  "instagram_handle": "user_instagram",
  "twitter_handle": "user_twitter",
  "spotify_handle": "user_spotify",
  "linkedin_handle": "in/user-linkedin"
}
```

**Update a single social media handle:**

```json
{
  "instagram_handle": "new_instagram_username"
}
```

**Remove a social media handle:**

```json
{
  "twitter_handle": null
}
```

### Response Format

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "id": "user-uuid",
      "first_name": "John",
      "last_name": "Doe",
      // other user fields...
      "instagram_handle": "user_instagram",
      "twitter_handle": "user_twitter",
      "spotify_handle": "user_spotify", 
      "linkedin_handle": "in/user-linkedin",
      "updated_at": "2023-07-10T12:34:56Z"
    }
  }
}
```

## Retrieving Social Media Handles

Social media handles are included in the user profile response:

**Endpoint:** `GET /api/profile`

**Authentication:** JWT token required in Authorization header

### Response Format

```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "user-uuid",
      "first_name": "John",
      "last_name": "Doe",
      // other user fields...
      "instagram_handle": "user_instagram",
      "twitter_handle": "user_twitter",
      "spotify_handle": "user_spotify",
      "linkedin_handle": "in/user-linkedin"
    }
  }
}
```

## Validation Rules

- All social media handles must be strings
- Maximum length per platform:
  - Instagram: 30 characters
  - Twitter: 15 characters
  - Spotify: 30 characters
  - LinkedIn: 100 characters
- Empty strings and null values are allowed to clear a handle 