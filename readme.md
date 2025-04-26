This backend server is built with Node.js, Express.js, and Socket.IO and is designed to support iOS apps, Android apps, macOS apps, Windows apps, Linux apps, and websites. It provides a compact and secure API layer for user authentication, real-time chat, and profile management, and interacts with Supabase and AWS S3 for data and file storage.

We use custom authentication instead of third-party services like Clerk. During registration, users must provide comprehensive profile information including first name, last name, gender, date of birth, email, phone number, username, password, preferences (Dating/Friendship), location access, and interests. Users can upload a profile picture during registration or later. Passwords are hashed with bcrypt before storing them in the database for security. Users can log in using either their email or username along with their password. Upon successful login, users receive a JWT (JSON Web Token), which they must provide in subsequent API requests and when connecting to Socket.IO for real-time operations. We also provide a /me route to fetch the currently authenticated user's information by validating the JWT token.

The backend offers APIs for user signup, login, profile fetching, and AWS S3 profile picture uploads and deletions. Uploading a profile picture involves generating a pre-signed S3 URL, ensuring that users can directly upload their pictures securely without exposing AWS credentials. When a new profile picture is uploaded, the server automatically deletes the previous picture to save storage space.

Our platform features a content sharing system that enables users to post images and videos (in reel format). Media content is processed, compressed, and stored in AWS S3 with appropriate optimization for fast loading across different devices and network conditions. Videos are automatically transcoded to multiple qualities to ensure smooth playback regardless of connection speed. The backend implements a sophisticated content recommendation algorithm that displays posts based on user interests, interaction history, and content popularity. The system prioritizes content from users with matching interest profiles while also introducing trending content to maintain engagement.

The backend includes viral content promotion algorithms that identify rapidly growing posts based on engagement velocity metrics, such as like-to-view ratio, comment frequency, and share rates within specific timeframes. Content determined to be "going viral" receives broader distribution across the user base. Users can engage with posts through likes, comments, and shares. All engagement metrics are tracked in real-time, with dedicated APIs for content creators to monitor their post performance. Comment systems support threading, mentions, and media attachments, with automatic moderation to filter inappropriate content.

Socket.IO is used for real-time communications, supporting both private one-to-one messaging and group messaging. Users are authenticated on Socket.IO connections using their JWT tokens before participating in any chats. Messages are saved to Supabase tables, ensuring persistence across sessions. The system tracks online status of users in real-time, enabling clients to display accurate availability indicators.

The backend implements a sophisticated matchmaking system based on mutual interests and preferences. Users can initiate matchmaking, which shows a "searching for user" status while the system finds compatible matches who are currently online. Once matched, both users receive an Accept/Reject prompt. If both accept, a private chat room is created. If rejected, the user returns to the matchmaking queue. The matching algorithm prioritizes shared interests, preference alignment (Dating/Friendship), and proximity based on location data.

The backend includes a robust search API allowing users to find others by name or username. Search results can be filtered by various parameters including interests, age range, and location proximity. Users can send direct connection requests to search results and, once accepted, can initiate private messaging.

The platform provides comprehensive analytics APIs for platform administrators, offering detailed insights into user growth, activity patterns, content performance, and engagement metrics. These APIs track key performance indicators such as daily active users, content creation rates, viral post statistics, average session duration, and conversion rates. Admin dashboards can visualize trends over time and identify potential areas for feature improvement. Analytics data is processed and aggregated in real-time using data streaming architecture to ensure up-to-date reporting with minimal delay.

Additional features include:
- User blocking functionality
- Read receipts for messages
- Typing indicators
- Message reactions and emoji support
- Content moderation for chat messages and posts
- Scheduled system notifications
- User activity logging for analytics
- Rate limiting to prevent abuse
- Robust error handling with detailed response codes
- Content discovery based on location and trending topics
- Post bookmarking and collections
- User verification badges for trusted accounts
- Advanced feed customization options

The server environment variables are managed using a .env file. AWS S3 credentials, Supabase keys, and JWT secret keys are stored securely. The server is designed with middleware for JWT validation and with utility functions for token generation/verification and password hashing/comparison.

Overall, the backend is fully modular, secure, scalable, and optimized for cross-platform client applications, ensuring a seamless experience for mobile, desktop, and web users.

