# System Health Monitoring API

The System Health Monitoring API provides comprehensive health metrics for the Circle Backend server. This documentation outlines both REST API endpoints and WebSocket events for real-time monitoring.

## REST API Endpoints

### Basic Health Check

```
GET /api/health/check
```

This public endpoint provides basic health status of the API and database. It does not require authentication.

**Response:**
```json
{
  "success": true,
  "data": {
    "api": {
      "status": "healthy",
      "responseTime": 45
    },
    "database": "healthy",
    "timestamp": "2023-05-16T14:30:15.123Z"
  }
}
```

### Detailed Health Metrics (Admin Only)

```
GET /api/health/detailed
```

This admin-only endpoint provides detailed health metrics including CPU, memory, database, and system information.

**Headers Required:**
- `Authorization: Bearer <jwt_token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "cpu": {
      "usage": 25,
      "averageLoad": 0.54,
      "currentLoad": 27,
      "coresUsage": [30, 15, 25, 22],
      "cores": 4
    },
    "memory": {
      "total": "16.0 GB",
      "free": "8.2 GB",
      "used": "7.8 GB",
      "usagePercentage": 48,
      "process": {
        "rss": "156.4 MB",
        "heapTotal": "85.5 MB",
        "heapUsed": "62.3 MB",
        "external": "2.3 MB"
      }
    },
    "apiServer": {
      "status": "healthy",
      "uptime": 345600,
      "responseTime": 120
    },
    "websocketServer": {
      "status": "healthy",
      "connectedClients": 52,
      "activeUsers": 48,
      "activeRooms": 23
    },
    "database": {
      "status": "healthy",
      "responseTime": 85,
      "connections": {
        "active": 12,
        "idle": 5,
        "total": 17,
        "maxConnections": 100
      },
      "storage": {
        "usedBytes": "256.5 MB",
        "totalBytes": "1.0 GB" 
      },
      "lastQueries": [
        {
          "query_text": "SELECT * FROM users WHERE id = $1",
          "execution_time_ms": 15,
          "executed_at": "2023-05-16T14:29:45.123Z"
        }
      ]
    },
    "system": {
      "platform": "linux",
      "arch": "x64",
      "nodeVersion": "v16.15.0",
      "hostname": "circle-api-backend-01"
    },
    "logs": {
      "logFiles": [
        {
          "name": "error-2023-05-16.log",
          "size": "1.2 MB",
          "lastModified": "2023-05-16T14:29:45.123Z",
          "recentEntries": "..."
        }
      ],
      "inMemoryLogs": [
        {
          "timestamp": "2023-05-16T14:29:45.123Z",
          "level": "info",
          "message": "User login successful"
        }
      ]
    }
  }
}
```

### Latest Health Metrics (Admin Only)

```
GET /api/health/metrics
```

This admin-only endpoint provides the latest health metrics in a more compact format, suitable for real-time monitoring.

**Headers Required:**
- `Authorization: Bearer <jwt_token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "cpu": {
      "usage": 25,
      "cores": 4,
      "model": "Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz",
      "speed": 3800
    },
    "memory": {
      "usagePercentage": 48,
      "total": 17179869184,
      "free": 8812027904,
      "used": 8367841280
    },
    "apiServer": {
      "status": "healthy",
      "uptime": 345600
    },
    "websocket": {
      "status": "healthy",
      "connectedClients": 52
    },
    "system": {
      "loadAverage": [0.54, 0.58, 0.67],
      "platform": "linux",
      "uptime": 1209600
    },
    "timestamp": "2023-05-16T14:30:15.123Z"
  },
  "message": "For real-time updates, use WebSocket with the health:subscribe event"
}
```

## Real-Time WebSocket Events

The system provides real-time health metrics through WebSocket events, pushing updates every 5 seconds.

### Subscribe to Health Updates

To receive real-time health updates, an admin user needs to subscribe using the following event:

```javascript
// From client side
socket.emit('health:subscribe');
```

After subscribing, the server will send a confirmation:

```javascript
// Server response
socket.on('health:subscribed', (data) => {
  console.log(data.message); // "Successfully subscribed to real-time health updates"
  console.log(data.updateFrequency); // Update frequency in milliseconds (5000)
});
```

### Receiving Health Updates

Once subscribed, the server will push health updates every 5 seconds:

```javascript
// Listen for health updates
socket.on('health:update', (metrics) => {
  console.log(metrics); // Health metrics object, similar to /api/health/metrics response
  updateDashboard(metrics); // Update your dashboard UI
});
```

### Unsubscribe from Health Updates

When the admin navigates away from the health dashboard, they should unsubscribe:

```javascript
// From client side
socket.emit('health:unsubscribe');

// Server response
socket.on('health:unsubscribed', (data) => {
  console.log(data.message); // "Successfully unsubscribed from health updates"
});
```

## Frontend Implementation Example

Here's a simple example of how to implement real-time health monitoring in a React component:

```jsx
import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { LineChart, BarChart } from 'your-chart-library';

const HealthDashboard = () => {
  const [socket, setSocket] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Initialize socket connection
  useEffect(() => {
    // Create socket connection with auth token
    const newSocket = io('https://api.example.com', {
      auth: {
        token: localStorage.getItem('jwt')
      }
    });
    
    setSocket(newSocket);
    
    // Cleanup on unmount
    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);
  
  // Subscribe to health updates
  useEffect(() => {
    if (!socket) return;
    
    // Handle connection
    socket.on('connect', () => {
      setIsConnected(true);
      // Subscribe to health updates
      socket.emit('health:subscribe');
    });
    
    // Handle subscription confirmation
    socket.on('health:subscribed', (data) => {
      console.log(`Subscribed to health updates. Updates every ${data.updateFrequency}ms`);
    });
    
    // Handle health updates
    socket.on('health:update', (data) => {
      setHealthData(data);
    });
    
    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      setIsConnected(false);
    });
    
    // Unsubscribe when component unmounts
    return () => {
      if (socket && socket.connected) {
        socket.emit('health:unsubscribe');
      }
    };
  }, [socket]);
  
  // Render loading state if no data yet
  if (!healthData) {
    return <div>Loading health data...</div>;
  }
  
  return (
    <div className="health-dashboard">
      <div className="connection-status">
        Connection Status: {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      
      <div className="metrics-summary">
        <h2>System Health</h2>
        <div className="metric-cards">
          <div className="metric-card">
            <h3>CPU Usage</h3>
            <div className="metric-value">{healthData.cpu.usage}%</div>
          </div>
          
          <div className="metric-card">
            <h3>Memory Usage</h3>
            <div className="metric-value">{healthData.memory.usagePercentage}%</div>
          </div>
          
          <div className="metric-card">
            <h3>Server Uptime</h3>
            <div className="metric-value">{formatUptime(healthData.apiServer.uptime)}</div>
          </div>
          
          <div className="metric-card">
            <h3>Connected Clients</h3>
            <div className="metric-value">{healthData.websocket.connectedClients}</div>
          </div>
        </div>
      </div>
      
      <div className="charts-container">
        <div className="chart">
          <h3>CPU Usage Over Time</h3>
          <LineChart data={cpuHistoryData} />
        </div>
        
        <div className="chart">
          <h3>Memory Usage Over Time</h3>
          <LineChart data={memoryHistoryData} />
        </div>
        
        <div className="chart">
          <h3>Connected Clients Over Time</h3>
          <LineChart data={clientsHistoryData} />
        </div>
      </div>
    </div>
  );
};

// Helper function to format uptime
const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  return `${days}d ${hours}h ${minutes}m`;
};

export default HealthDashboard;
```

## Storing Historical Health Data

The system automatically stores health snapshots in the database every 5 minutes, allowing you to create historical trends and reports. These are stored in the `health_checks` table and can be queried using standard SQL.

Example query to get hourly averages:

```sql
SELECT 
  date_trunc('hour', checked_at) as hour,
  AVG(cpu_usage) as avg_cpu,
  AVG(memory_usage) as avg_memory
FROM health_checks
WHERE checked_at > NOW() - INTERVAL '7 days'
GROUP BY date_trunc('hour', checked_at)
ORDER BY hour;
```

This enables you to build both real-time dashboards and historical analysis views for your admin panel. 