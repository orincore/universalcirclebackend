# Admin Authentication API

This document outlines the API endpoints for admin authentication in the Circle Backend server.

## Admin Authentication

### Admin Login

Authenticates an admin user and returns a JWT token.

```
POST /api/admin/auth/login
```

**Request Body:**
```json
{
  "emailOrUsername": "admin@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Admin login successful",
  "data": {
    "admin": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "username": "admin",
      "email": "admin@example.com",
      "first_name": "Admin",
      "last_name": "User",
      "is_admin": true,
      "role": "admin",
      "last_login": "2023-05-16T14:30:15.123Z",
      "admin_login_count": 5
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Errors:**
- `400 Bad Request`: Invalid request body
- `401 Unauthorized`: Invalid credentials
- `500 Internal Server Error`: Server error

### Get Admin Profile

Retrieves the profile information of the currently authenticated admin.

```
GET /api/admin/auth/profile
```

**Headers Required:**
- `Authorization: Bearer <jwt_token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "admin": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "username": "admin",
      "email": "admin@example.com",
      "first_name": "Admin",
      "last_name": "User",
      "is_admin": true,
      "role": "admin",
      "last_login": "2023-05-16T14:30:15.123Z"
    }
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid or missing token
- `403 Forbidden`: User is not an admin
- `500 Internal Server Error`: Server error

### Validate Admin Token

Checks if the provided token is valid and belongs to an admin user.

```
GET /api/admin/auth/validate
```

**Headers Required:**
- `Authorization: Bearer <jwt_token>`

**Response:**
```json
{
  "success": true,
  "message": "Valid admin token",
  "data": {
    "isValidAdmin": true
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid or missing token
- `403 Forbidden`: User is not an admin
- `500 Internal Server Error`: Server error

## Implementation Notes

### JWT Token

The JWT token returned from the login endpoint contains the following claims:

- `userId`: The ID of the admin user
- `email`: The email of the admin user
- `username`: The username of the admin user
- `isAdmin`: A boolean flag indicating admin status (always true for admin tokens)
- `exp`: Token expiration timestamp
- `iat`: Token issued at timestamp

### Security Considerations

1. Admin login attempts are logged for security monitoring
2. Failed login attempts do not reveal whether the username/email exists or if the password was incorrect
3. Admin tokens include an additional `isAdmin` claim to clearly identify admin users
4. Admin-specific endpoints require both authentication and admin privileges

### Using Admin Authentication in Frontend

Here's a sample code snippet showing how to implement admin login in a React frontend:

```jsx
import axios from 'axios';

const adminLogin = async (emailOrUsername, password) => {
  try {
    const response = await axios.post('/api/admin/auth/login', {
      emailOrUsername,
      password
    });
    
    if (response.data.success) {
      // Store the token in localStorage or secure cookie
      localStorage.setItem('adminToken', response.data.data.token);
      
      // Set Authorization header for future requests
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.data.token}`;
      
      return response.data.data.admin;
    }
  } catch (error) {
    console.error('Admin login failed:', error.response?.data?.message || error.message);
    throw error;
  }
};

const validateAdminToken = async () => {
  try {
    const token = localStorage.getItem('adminToken');
    
    if (!token) {
      return false;
    }
    
    const response = await axios.get('/api/admin/auth/validate', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    return response.data.success && response.data.data.isValidAdmin;
  } catch (error) {
    console.error('Token validation failed:', error.response?.data?.message || error.message);
    return false;
  }
};

export { adminLogin, validateAdminToken };
```

## Database Schema

Admin users are stored in the same `users` table as regular users, but with the `is_admin` flag set to `true`.

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  role VARCHAR(20) DEFAULT 'user',
  admin_login_count INTEGER DEFAULT 0,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
``` 