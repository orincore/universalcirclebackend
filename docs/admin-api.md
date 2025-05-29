# Universal Circle Admin API Documentation

## Authentication

All admin routes in Universal Circle use standard JWT authentication with admin privilege verification.

1. **Token Requirements**:
   - Standard JWT token obtained through regular login
   - The user associated with the token must have admin privileges (`is_admin: true` in the users table)

2. **Authentication Header**:
   ```
   Authorization: Bearer <jwt_token>
   ```

3. **Authentication Flow**:
   - The `authenticate` middleware verifies the JWT token
   - The `isAdmin` middleware checks if the authenticated user has admin privileges
   - If both checks pass, the request is processed

## User Management Endpoints

### Delete User

Deletes a user and all associated data. Supports both soft deletion (default) and hard deletion.

**Endpoint**: `DELETE /api/admin/users/:userId`

**URL Parameters**:
- `userId`: UUID of the user to delete

**Query Parameters**:
- `hard_delete`: Set to "true" for permanent deletion. Default is "false" (soft delete)

**Response Codes**:
- `200`: User successfully deleted
- `400`: Invalid request parameters
- `404`: User not found
- `403`: Not authorized as admin
- `500`: Server error

#### Soft Delete vs. Hard Delete

- **Soft Delete** (default):
  - Anonymizes user data rather than removing it
  - Updates user fields to anonymized values
  - Sets `is_deleted: true` and records deletion metadata
  - Preserves database referential integrity

- **Hard Delete**:
  - Permanently removes user record from database
  - Deletes all associated data (messages, matches, reactions, reports)
  - Disconnects any active socket connections
  - Removes from matchmaking pools and active matches

#### Example Usage

**JavaScript (Browser)**:
```javascript
// Assuming you have the JWT token stored
const token = localStorage.getItem('auth_token');
const userId = 'user-uuid-to-delete';
const hardDelete = true; // Set to false for soft delete

// API call
fetch(`/api/admin/users/${userId}?hard_delete=${hardDelete}`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log('User deleted:', data))
.catch(error => console.error('Error:', error));
```

**Node.js (with axios)**:
```javascript
const axios = require('axios');

// Use a valid JWT token from a user with admin privileges
const token = 'your_admin_jwt_token';
const userId = 'user-uuid-to-delete';

axios.delete(`http://your-api.com/api/admin/users/${userId}`, {
  headers: {
    'Authorization': `Bearer ${token}`
  },
  params: {
    hard_delete: true // Set to false for soft delete
  }
})
.then(response => console.log('User deleted:', response.data))
.catch(error => console.error('Error:', error.response?.data || error.message));
```

## Security Considerations

1. Admin tokens have elevated privileges and should be handled with extra care
2. All admin actions are logged with the admin's user ID for audit purposes
3. Consider implementing additional verification for critical operations
4. Hard deletion operations cannot be reversed - use with caution 