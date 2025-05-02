# Bullet.js Security Guide

This document outlines security best practices, potential vulnerabilities, and recommendations for securing your Bullet.js applications in production environments.

## Table of Contents

- [Introduction](#introduction)
- [Data Storage Security](#data-storage-security)
- [Authentication & Authorization](#authentication--authorization)
- [Input Validation](#input-validation)
- [Middleware Security](#middleware-security)

## Introduction

Bullet.js is a distributed graph database with both client and server capabilities. Its distributed nature introduces unique security considerations that developers should be aware of and actively mitigate. This guide will help you secure your Bullet.js applications against common threats.

## Data Storage Security

### Encryption at Rest

Bullet.js supports file-based storage with encryption:

```javascript
const bullet = new Bullet({
  storage: true,
  storageType: "file",
  storagePath: "./secure-data",
  encrypt: true,
  encryptionKey: process.env.ENCRYPTION_KEY, // Never hardcode encryption keys
});
```

Key recommendations:

- **Always enable encryption** for production data
- **Use environment variables** for encryption keys
- **Generate strong encryption keys** (32+ bytes of high entropy)
- **Rotate encryption keys** periodically
- **Back up encryption keys** securely (losing the key means losing access to data)

### Custom Storage Security

When implementing custom storage adapters:

```javascript
class MySecureStorage extends BulletStorage {
  // Implementation with additional security measures
}

const bullet = new Bullet({
  storageType: MySecureStorage,
});
```

Considerations:

- Implement appropriate encryption/decryption in custom providers
- Sanitize data before storage to prevent injection attacks
- Add rate limiting to prevent abuse
- Implement audit logging for sensitive operations

### Secure WebSocket Connections

By default, Bullet.js uses unencrypted WebSocket connections:

```javascript
const bullet = new Bullet({
  server: true,
  port: 8765,
  host: "0.0.0.0", // Binds to all interfaces - use with caution!
});
```

To secure network communications:

- **Use a TLS reverse proxy** (Nginx, Caddy, etc.) in front of Bullet.js
- Configure the proxy to terminate SSL/TLS and forward to Bullet.js
- Restrict Bullet.js to listen only on localhost or internal networks
- Never expose an unencrypted Bullet.js server directly to the internet

Example setup with local binding:

```javascript
const bullet = new Bullet({
  server: true,
  port: 8765,
  host: "127.0.0.1", // Only accept connections from localhost
});
```

### Connection Handler for Authentication

Bullet.js supports a connection handler for authenticating incoming connections:

```javascript
const bullet = new Bullet({
  // Network options
  connectionHandler: (req, socket, remotePeerId) => {
    // Check authentication headers
    const authToken = req.headers["authorization"];

    if (!isValidToken(authToken)) {
      console.warn(`Rejecting unauthenticated connection from ${remotePeerId}`);
      socket.close();
      return false; // Reject the connection
    }

    // For accepted connections, you can also log the connection
    console.log(`Authenticated connection from ${remotePeerId}`);
    return true; // Accept the connection
  },

  // Add custom headers to outbound connections
  prepareConnectionHeaders: (peerUrl) => {
    return {
      authorization: generateAuthToken(),
      "x-client-version": "1.0.0",
    };
  },
});
```

#### IP-based Access Control

You can implement IP whitelist or blacklist checking in your connection handler:

```javascript
const bullet = new Bullet({
  connectionHandler: (req, socket, remotePeerId) => {
    // Get the client's IP address from the request
    const clientIP = req.socket.remoteAddress;

    // IP Whitelist approach
    const allowedIPs = ["127.0.0.1", "192.168.1.100", "10.0.0.5"];
    if (!allowedIPs.includes(clientIP)) {
      console.warn(`Rejecting connection from non-whitelisted IP: ${clientIP}`);
      socket.close();
      return false;
    }

    // Alternative: IP Blacklist approach
    const blockedIPs = ["1.2.3.4", "5.6.7.8"];
    if (blockedIPs.includes(clientIP)) {
      console.warn(`Rejecting connection from blacklisted IP: ${clientIP}`);
      socket.close();
      return false;
    }

    // CIDR range checking (with helper function)
    if (isIPInBlockedRange(clientIP)) {
      console.warn(`Rejecting connection from blocked IP range: ${clientIP}`);
      socket.close();
      return false;
    }

    return true;
  },
});

// Helper function to check if IP is in a CIDR range
function isIPInBlockedRange(ip) {
  const blockedRanges = ["192.168.0.0/16", "10.0.0.0/8"];
  // Implementation of CIDR checking logic
  // ...
  return false;
}
```

Key security practices for connection handlers:

- Implement token validation with proper cryptographic methods
- Use HTTPS-only cookies for browser clients
- Consider implementing rate limiting within your handler
- Log all connection attempts, both successful and failed
- Consider IP-based restrictions for sensitive deployments
- Use a combination of IP filtering and token authentication for highest security
- Remember that IP addresses can be spoofed, so don't rely on them as the only security measure

## Authentication & Authorization

Bullet.js doesn't include built-in authentication, but you can implement it using middleware:

```javascript
bullet.use("put", (path, data) => {
  const token = /* extract from request context */;
  if (!isAuthenticated(token)) {
    throw new Error("Authentication required");
  }
  return data;
});
```

For role-based access control:

```javascript
bullet.middleware.accessControl(
  "users/.*", // RegExp for paths to protect
  (path, operation, data) => {
    // Check if user has permission for operation on path
    return hasPermission(getCurrentUser(), path, operation);
  },
  ["read", "write", "delete"] // Operations to protect
);
```

Recommendations:

- Implement token-based authentication (JWT, etc.)
- Use fine-grained authorization with path-based controls
- Apply the principle of least privilege
- Consider implementing path-based encryption for sensitive data
- Add audit logging for all authentication/authorization events

## Input Validation

Use Bullet.js's built-in validation to enforce data integrity:

```javascript
// Define a schema
bullet.defineSchema("user", {
  type: "object",
  properties: {
    username: { type: "string", pattern: "^[a-zA-Z0-9]{3,16}$" },
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["user", "admin"] },
  },
  required: ["username", "email"],
});

// Apply schema to a path
bullet.applySchema("users", "user");

// Register validation error handlers
bullet.onValidationError("all", (error) => {
  console.error("Validation error:", error);
  // Log validation failures for security monitoring
});
```

Key validation security practices:

- **Always validate user input** before processing
- Validate on both client and server sides
- Use strict schema validation for all data paths
- Consider adding custom validators for domain-specific security rules
- Monitor and alert on validation failures (potential attack indicators)

## Middleware Security

Use middleware for security functions:

```javascript
// Sanitize input data
bullet.beforePut((path, data) => {
  return sanitizeData(data);
});

// Add rate limiting
let requestCounts = {};
bullet.beforePut((path, data) => {
  const clientId = /* identify client */;

  // Implement rate limiting
  if (isRateLimited(clientId, path)) {
    throw new Error("Rate limit exceeded");
  }

  return data;
});

// Implement logging
bullet.middleware.log(["write", "delete"], (operation, info) => {
  securityLogger.log({
    operation,
    path: info.path,
    timestamp: new Date(),
    client: /* client identifier */
  });
});
```

Additional middleware security features:

- Implement request throttling to prevent DoS attacks
- Add field-level encryption for sensitive data
- Create security-focused event listeners
- Use path rewriting for security boundaries

## Conclusion

Security is an ongoing process, not a one-time implementation. Regularly review your Bullet.js application for security vulnerabilities and keep up with best practices. Consider engaging security professionals to audit your implementation, especially for applications dealing with sensitive data.

By following the recommendations in this guide, you can significantly reduce the risk of security incidents in your Bullet.js applications.

## Next Steps

Now that you've learned about securing Bullet.js applications, you might want to explore:

- [Performance Optimization](/docs/performance.md) - Optimize your Bullet.js applications
- [Deployment](/docs/deployment.md) - Deploy Bullet.js in production environments
- [Storage Adapters](/docs/storage-adapters.md) - Learn about secure storage options
- [Advanced Middleware](/docs/advanced-middleware.md) - Implement complex security patterns
