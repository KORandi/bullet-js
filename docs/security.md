# Security in Bullet.js

Securing your Bullet.js applications is crucial, especially in distributed environments. This guide covers security best practices, potential vulnerabilities, and strategies to keep your data and communications safe.

## You will learn

- How to secure communication between peers
- How to implement proper authentication and authorization
- How to encrypt data at rest and in transit
- How to prevent common security vulnerabilities
- How to implement security-focused middleware

## Understanding Security Challenges

Distributed databases like Bullet.js face several unique security challenges:

1. **Peer authentication**: Verifying the identity of connecting peers
2. **Data access control**: Limiting which peers can access specific data
3. **Data integrity**: Ensuring data isn't tampered with during transit
4. **Data privacy**: Keeping sensitive information confidential
5. **Network security**: Securing connections between peers

## Securing Network Communication

### WebSocket Security

Bullet.js uses WebSockets for peer communication. To secure these connections:

```javascript
// Server with secure WebSockets (wss://)
const httpsServer = require("https").createServer({
  key: fs.readFileSync("server-key.pem"),
  cert: fs.readFileSync("server-cert.pem"),
});

const bullet = new Bullet({
  server: httpsServer, // Use HTTPS server
  port: 8765,
});

// Client connecting to secure WebSocket
const client = new Bullet({
  peers: ["wss://secure-server.example.com:8765"],
});
```

### Connection Validation

Implement connection validation with connection tokens:

```javascript
// Generate a secure connection token
function generateConnectionToken(peerId) {
  const secret = "your-secret-key"; // Store securely in environment variable
  const timestamp = Date.now();
  const data = `${peerId}:${timestamp}`;

  // Create HMAC signature
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  const signature = hmac.digest("hex");

  return `${data}:${signature}`;
}

// Verify a connection token
function verifyConnectionToken(token) {
  const secret = "your-secret-key";
  const [peerId, timestamp, signature] = token.split(":");

  // Check token age (e.g., valid for 5 minutes)
  if (Date.now() - parseInt(timestamp) > 5 * 60 * 1000) {
    return false;
  }

  // Verify signature
  const data = `${peerId}:${timestamp}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  const expectedSignature = hmac.digest("hex");

  return signature === expectedSignature ? peerId : false;
}

// Server implementation with token validation
const wss = new WebSocket.Server({ port: 8765 });

wss.on("connection", (ws, req) => {
  const token = req.headers["x-connection-token"];

  if (!token) {
    console.log("Connection rejected: No token provided");
    ws.close(1008, "Authentication required");
    return;
  }

  const peerId = verifyConnectionToken(token);

  if (!peerId) {
    console.log("Connection rejected: Invalid token");
    ws.close(1008, "Authentication failed");
    return;
  }

  console.log(`Authenticated peer ${peerId} connected`);

  // Continue with connection handling
  // ...
});
```

### Implement IP Allowlisting

Restrict which IP addresses can connect:

```javascript
// List of allowed IP addresses or CIDR blocks
const allowedIPs = [
  "192.168.1.0/24", // Internal network
  "203.0.113.42", // Specific external IP
  "2001:db8::/32", // IPv6 range
];

function isIPAllowed(ip) {
  // Simple exact match
  if (allowedIPs.includes(ip)) {
    return true;
  }

  // Check CIDR blocks
  for (const cidr of allowedIPs) {
    if (cidr.includes("/") && ipInCIDR(ip, cidr)) {
      return true;
    }
  }

  return false;
}

// Use in server connection handler
wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;

  if (!isIPAllowed(ip)) {
    console.log(`Connection rejected from disallowed IP: ${ip}`);
    ws.close(1008, "Access denied");
    return;
  }

  // Continue with connection handling
  // ...
});
```

## Authentication and Authorization

### Implementing User Authentication

```javascript
// Simple authentication middleware
bullet.middleware.beforePut((path, data) => {
  const currentUser = getCurrentUser(); // Implement based on your auth system

  if (!currentUser) {
    console.log("Write attempt by unauthenticated user");
    return false; // Reject the operation
  }

  // Add user info to the data
  return {
    ...data,
    updatedBy: currentUser.id,
    updatedAt: Date.now(),
  };
});
```

### Role-Based Access Control

```javascript
// Define user roles and permissions
const roles = {
  admin: {
    read: ["*"], // Can read everything
    write: ["*"], // Can write everything
    delete: ["*"], // Can delete everything
  },
  editor: {
    read: ["*"], // Can read everything
    write: ["posts/*", "comments/*"], // Can edit posts and comments
    delete: ["posts/*", "comments/*"], // Can delete posts and comments
  },
  user: {
    read: ["*"], // Can read everything
    write: ["comments/*", "users/${userId}/*"], // Can edit own comments and profile
    delete: ["comments/${userId}/*"], // Can delete own comments
  },
};

// Path permission check function
function checkPermission(userId, userRole, operation, path) {
  const userPermissions = roles[userRole] || roles.user;
  const permissions = userPermissions[operation] || [];

  for (const pattern of permissions) {
    // Replace variables in pattern
    const resolvedPattern = pattern.replace(/\${userId}/g, userId);

    // Check if path matches pattern
    if (
      resolvedPattern === "*" ||
      path === resolvedPattern ||
      (resolvedPattern.endsWith("/*") &&
        path.startsWith(resolvedPattern.slice(0, -2)))
    ) {
      return true;
    }
  }

  return false;
}

// Implement middleware for RBAC
bullet.middleware.beforePut((path, data) => {
  const user = getCurrentUser();

  if (!user) {
    return false; // No user, reject
  }

  if (!checkPermission(user.id, user.role, "write", path)) {
    console.log(
      `User ${user.id} (${user.role}) denied write access to ${path}`
    );
    return false; // Permission denied
  }

  return data; // Allow the operation
});

bullet.middleware.onGet((path) => {
  const user = getCurrentUser();

  if (!user) {
    return "public/*"; // Anonymous users can only access public data
  }

  if (!checkPermission(user.id, user.role, "read", path)) {
    console.log(`User ${user.id} (${user.role}) denied read access to ${path}`);
    return "public/*"; // Redirect to public data
  }

  return path; // Allow access to requested path
});

bullet.middleware.beforeDelete((path) => {
  const user = getCurrentUser();

  if (!user || !checkPermission(user.id, user.role, "delete", path)) {
    console.log(
      `User ${user.id} (${user.role}) denied delete access to ${path}`
    );
    return false; // Permission denied
  }

  return true; // Allow deletion
});
```

### Multi-Tenant Isolation

For multi-tenant applications, isolate data between tenants:

```javascript
// Tenant isolation middleware
bullet.middleware.onGet((path) => {
  const user = getCurrentUser();

  if (!user || !user.tenantId) {
    return "public/*"; // Redirect to public data
  }

  // For admin paths, no change
  if (path.startsWith("admin/") && user.role === "admin") {
    return path;
  }

  // For all other paths, scope to tenant
  return `tenants/${user.tenantId}/${path}`;
});

bullet.middleware.beforePut((path, data) => {
  const user = getCurrentUser();

  if (!user || !user.tenantId) {
    return false; // Reject writes for unauthenticated users
  }

  // For admin paths, no scoping
  if (path.startsWith("admin/") && user.role === "admin") {
    return data;
  }

  // All other data is scoped to tenant - we rewrite the path
  bullet.get(`tenants/${user.tenantId}/${path}`).put(data);

  // Prevent the original put
  return false;
});
```

## Data Encryption

### Encrypting Sensitive Fields

```javascript
// Utility functions for field encryption
const crypto = require("crypto");

function encryptField(text, key) {
  if (!text) return null;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
}

function decryptField(encryptedText, key) {
  if (!encryptedText) return null;

  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// Register middleware for field encryption
bullet.middleware.beforePut((path, data) => {
  if (path.startsWith("users/") && typeof data === "object" && data !== null) {
    const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");

    // Encrypt sensitive fields
    if (data.ssn) {
      data.ssn = encryptField(data.ssn, encryptionKey);
    }

    if (data.creditCard) {
      data.creditCard = encryptField(data.creditCard, encryptionKey);
    }

    if (data.bankAccount) {
      data.bankAccount = encryptField(data.bankAccount, encryptionKey);
    }
  }

  return data;
});

bullet.middleware.afterGet((path, data) => {
  if (path.startsWith("users/") && typeof data === "object" && data !== null) {
    const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");

    // Decrypt sensitive fields
    if (data.ssn && data.ssn.includes(":")) {
      try {
        data.ssn = decryptField(data.ssn, encryptionKey);
      } catch (err) {
        console.error("Failed to decrypt SSN:", err);
        data.ssn = "[Encryption Error]";
      }
    }

    if (data.creditCard && data.creditCard.includes(":")) {
      try {
        data.creditCard = decryptField(data.creditCard, encryptionKey);
      } catch (err) {
        data.creditCard = "[Encryption Error]";
      }
    }

    if (data.bankAccount && data.bankAccount.includes(":")) {
      try {
        data.bankAccount = decryptField(data.bankAccount, encryptionKey);
      } catch (err) {
        data.bankAccount = "[Encryption Error]";
      }
    }
  }

  return data;
});
```

### Encrypting All Data in Storage

Bullet.js supports encryption for its file storage:

```javascript
// Enable storage encryption
const bullet = new Bullet({
  storage: true,
  encrypt: true,
  encryptionKey: process.env.STORAGE_ENCRYPTION_KEY, // Use environment variable
});
```

For custom storage adapters, implement encryption:

```javascript
class EncryptedStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      encrypt: true,
      encryptionKey: process.env.STORAGE_ENCRYPTION_KEY,
      ...options,
    });

    // Validate encryption key
    if (this.options.encrypt && !this.options.encryptionKey) {
      throw new Error("Encryption key is required when encryption is enabled");
    }

    this._initStorage();
  }

  _encrypt(data) {
    if (!this.options.encrypt) {
      return data;
    }

    try {
      const key = this._getEncryptionKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

      let encrypted = cipher.update(data, "utf8", "hex");
      encrypted += cipher.final("hex");

      return `${iv.toString("hex")}:${encrypted}`;
    } catch (err) {
      console.error("Encryption failed:", err);
      throw err;
    }
  }

  _decrypt(data) {
    if (!this.options.encrypt) {
      return data;
    }

    try {
      const key = this._getEncryptionKey();
      const [ivHex, encrypted] = data.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (err) {
      console.error("Decryption failed:", err);
      throw err;
    }
  }

  _getEncryptionKey() {
    const keyMaterial = this.options.encryptionKey;

    // If key is already the right size, use it directly
    if (Buffer.isBuffer(keyMaterial) && keyMaterial.length === 32) {
      return keyMaterial;
    }

    // Otherwise, derive a key
    return crypto.createHash("sha256").update(String(keyMaterial)).digest();
  }

  async _saveData() {
    try {
      if (this._hasChanges()) {
        const json = JSON.stringify({
          store: this.bullet.store,
          meta: this.bullet.meta,
          log: this.bullet.log,
        });

        const encrypted = this._encrypt(json);

        // Save encrypted data
        fs.writeFileSync(this.options.filePath, encrypted);

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }

    return Promise.resolve();
  }

  async _loadData() {
    try {
      if (fs.existsSync(this.options.filePath)) {
        const encryptedData = fs.readFileSync(this.options.filePath, "utf8");
        const json = this._decrypt(encryptedData);
        const data = JSON.parse(json);

        this._deepMerge(this.bullet.store, data.store || {});
        Object.assign(this.bullet.meta, data.meta || {});
        this.bullet.log = [...this.bullet.log, ...(data.log || [])];

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];
      }
    } catch (err) {
      console.error("Error loading data:", err);
    }
  }
}
```

## Input Validation and Sanitization

### Schema Validation

Use Bullet.js's built-in validation to prevent invalid data:

```javascript
// Define user schema with validation
bullet.defineSchema("user", {
  type: "object",
  required: ["username", "email"],
  properties: {
    username: {
      type: "string",
      min: 3,
      max: 20,
      pattern: "^[a-zA-Z0-9_]+$", // Alphanumeric and underscore only
    },
    email: {
      type: "string",
      format: "email",
    },
    role: {
      type: "string",
      enum: ["user", "editor", "admin"],
    },
    // More fields...
  },
});

// Apply schema to user data
bullet.applySchema("users", "user");
```

### Content Sanitization

Sanitize user-generated content:

```javascript
// Sanitize HTML in content fields
bullet.middleware.beforePut((path, data) => {
  if (path.startsWith("posts/") || path.startsWith("comments/")) {
    if (typeof data === "object" && data !== null) {
      // Simple HTML sanitization
      if (data.content) {
        data.content = sanitizeHTML(data.content);
      }

      // Sanitize other fields
      if (data.title) {
        data.title = data.title.replace(/<[^>]*>/g, ""); // Strip HTML tags
      }
    }
  }

  return data;
});

// HTML sanitization function
function sanitizeHTML(html) {
  if (!html) return "";

  // Remove potentially dangerous tags
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "") // Remove event handlers
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, ""); // Remove javascript: URLs
}
```

## Protecting Against Common Vulnerabilities

### Preventing Injection Attacks

```javascript
// Protect against NoSQL injection by validating object keys
bullet.middleware.beforePut((path, data) => {
  // Only allow certain characters in keys
  if (typeof data === "object" && data !== null) {
    const validateObject = (obj) => {
      for (const key of Object.keys(obj)) {
        // Check key format (alphanumeric plus some safe characters)
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(key)) {
          console.error(`Invalid key format: ${key}`);
          return false;
        }

        // Recursively check nested objects
        if (
          typeof obj[key] === "object" &&
          obj[key] !== null &&
          !Array.isArray(obj[key])
        ) {
          if (!validateObject(obj[key])) {
            return false;
          }
        }
      }
      return true;
    };

    if (!validateObject(data)) {
      return false; // Reject the operation
    }
  }

  return data;
});
```

### Path Validation

```javascript
// Validate path components to prevent traversal attacks
bullet.middleware.onGet((path) => {
  // Only allow safe paths
  if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(path)) {
    console.error(`Suspicious path rejected: ${path}`);
    return "error/invalid-path"; // Redirect to error path
  }

  // Prevent path traversal attempts
  if (path.includes("..")) {
    console.error(`Path traversal attempt: ${path}`);
    return "error/invalid-path";
  }

  return path;
});
```

### Rate Limiting

```javascript
// Simple in-memory rate limiter
const rateLimits = {
  reads: { limit: 100, window: 60000 }, // 100 reads per minute
  writes: { limit: 20, window: 60000 }, // 20 writes per minute
  deletes: { limit: 5, window: 60000 }, // 5 deletes per minute
};

const clientUsage = new Map();

function checkRateLimit(clientId, operation) {
  const now = Date.now();

  if (!clientUsage.has(clientId)) {
    clientUsage.set(clientId, {
      reads: [],
      writes: [],
      deletes: [],
    });
  }

  const usage = clientUsage.get(clientId);
  const opUsage = usage[operation];
  const limit = rateLimits[operation];

  // Remove expired timestamps
  while (opUsage.length > 0 && opUsage[0] < now - limit.window) {
    opUsage.shift();
  }

  // Check if limit is reached
  if (opUsage.length >= limit.limit) {
    return false;
  }

  // Record the operation
  opUsage.push(now);
  return true;
}

// Apply rate limiting to operations
bullet.middleware.onGet((path) => {
  const clientId = getCurrentClientId();

  if (!checkRateLimit(clientId, "reads")) {
    console.error(`Rate limit exceeded for reads by ${clientId}`);
    return "error/rate-limit";
  }

  return path;
});

bullet.middleware.beforePut((path, data) => {
  const clientId = getCurrentClientId();

  if (!checkRateLimit(clientId, "writes")) {
    console.error(`Rate limit exceeded for writes by ${clientId}`);
    return false;
  }

  return data;
});

bullet.middleware.beforeDelete((path) => {
  const clientId = getCurrentClientId();

  if (!checkRateLimit(clientId, "deletes")) {
    console.error(`Rate limit exceeded for deletes by ${clientId}`);
    return false;
  }

  return true;
});
```

## Secure Logging and Auditing

### Audit Logging

```javascript
// Create an audit log
const auditLog = [];

bullet.middleware.afterPut((path, newData, oldData) => {
  const user = getCurrentUser();

  auditLog.push({
    timestamp: new Date().toISOString(),
    operation: "write",
    path,
    userId: user ? user.id : "system",
    changes: calculateChanges(oldData, newData),
  });

  // Optionally persist the audit log
  bullet.get("system/auditLog").put(auditLog);
});

bullet.middleware.afterDelete((path, oldData) => {
  const user = getCurrentUser();

  auditLog.push({
    timestamp: new Date().toISOString(),
    operation: "delete",
    path,
    userId: user ? user.id : "system",
    previousValue: oldData,
  });

  // Optionally persist the audit log
  bullet.get("system/auditLog").put(auditLog);
});

// Calculate changes between objects
function calculateChanges(oldData, newData) {
  if (!oldData || typeof oldData !== "object") {
    return { full: true, newValue: newData };
  }

  const changes = {};

  // Find added or modified fields
  for (const [key, value] of Object.entries(newData)) {
    if (
      !oldData[key] ||
      JSON.stringify(oldData[key]) !== JSON.stringify(value)
    ) {
      changes[key] = {
        previous: oldData[key],
        new: value,
      };
    }
  }

  // Find removed fields
  for (const key of Object.keys(oldData)) {
    if (!(key in newData)) {
      changes[key] = {
        previous: oldData[key],
        new: undefined,
      };
    }
  }

  return changes;
}
```

### Security Event Monitoring

```javascript
const securityEvents = [];

// Monitor authentication attempts
function recordAuthEvent(success, userId, details) {
  securityEvents.push({
    type: "auth",
    success,
    userId,
    timestamp: new Date().toISOString(),
    ipAddress: getCurrentIp(),
    userAgent: getCurrentUserAgent(),
    details,
  });

  // Alert on suspicious activity
  if (!success && details.reason === "invalid_token") {
    console.warn(`Potential security issue: Invalid token for user ${userId}`);

    // Check for multiple failures
    const recentFailures = securityEvents.filter(
      (e) =>
        e.type === "auth" &&
        !e.success &&
        e.userId === userId &&
        new Date(e.timestamp) > new Date(Date.now() - 3600000)
    );

    if (recentFailures.length >= 5) {
      console.error(
        `SECURITY ALERT: Multiple auth failures for user ${userId}`
      );
      notifySecurityTeam("multiple_auth_failures", {
        userId,
        count: recentFailures.length,
      });
    }
  }
}

// Monitor write operations to sensitive paths
bullet.middleware.beforePut((path, data) => {
  if (path.startsWith("admin/") || path.startsWith("security/")) {
    const user = getCurrentUser();

    securityEvents.push({
      type: "sensitive_write",
      userId: user ? user.id : "unknown",
      path,
      timestamp: new Date().toISOString(),
      ipAddress: getCurrentIp(),
    });

    // Require elevated permissions
    if (!user || user.role !== "admin") {
      console.error(`Unauthorized attempt to modify sensitive path: ${path}`);
      return false;
    }
  }

  return data;
});
```

## Implementing Least Privilege

### Per-User Credentials

```javascript
// Generate per-user API credentials
function generateUserCredentials(userId) {
  const apiKey = crypto.randomBytes(16).toString("hex");
  const apiSecret = crypto.randomBytes(32).toString("hex");

  // Store the credentials securely
  bullet.get(`internal/credentials/${userId}`).put({
    apiKey,
    apiSecret: hashSecret(apiSecret), // Only store hash of secret
    createdAt: new Date().toISOString(),
    permissions: ["read:*", `write:users/${userId}/*`],
  });

  // Return the credentials to the user (only once)
  return {
    apiKey,
    apiSecret,
  };
}

// Authenticate API requests
function authenticateApiRequest(apiKey, signature, timestamp, payload) {
  // Find credentials by API key
  const allCredentials = bullet.get("internal/credentials").value() || {};

  let userId = null;
  let credentials = null;

  for (const [id, creds] of Object.entries(allCredentials)) {
    if (creds.apiKey === apiKey) {
      userId = id;
      credentials = creds;
      break;
    }
  }

  if (!credentials) {
    return { authenticated: false, reason: "invalid_key" };
  }

  // Verify timestamp freshness (within 15 minutes)
  const requestTime = new Date(timestamp);
  const now = new Date();

  if (Math.abs(now - requestTime) > 15 * 60 * 1000) {
    return { authenticated: false, reason: "expired_timestamp" };
  }

  // Verify signature
  const expectedSignature = createSignature(
    apiKey,
    credentials.apiSecret,
    timestamp,
    payload
  );

  if (signature !== expectedSignature) {
    return { authenticated: false, reason: "invalid_signature" };
  }

  return {
    authenticated: true,
    userId,
    permissions: credentials.permissions,
  };
}

// Implement in middleware
bullet.middleware.onGet((path) => {
  const auth = getCurrentAuth();

  if (!auth.authenticated) {
    return "public/*"; // Redirect to public data
  }

  // Check path permissions
  const canRead = auth.permissions.some((perm) => {
    if (perm === "read:*") return true;

    const pattern = perm.replace("read:", "");
    return (
      path === pattern ||
      (pattern.endsWith("/*") && path.startsWith(pattern.slice(0, -2)))
    );
  });

  if (!canRead) {
    return "public/*"; // Redirect to public data
  }

  return path;
});
```

### Privilege Separation

```javascript
// Create separate Bullet instances for different security domains
const publicBullet = new Bullet({
  // Public-facing instance with limited capabilities
  enableValidation: true,
  enableMiddleware: true,
  // No storage, no network to isolate data
});

const privateBullet = new Bullet({
  // Internal instance with full capabilities
  enableValidation: true,
  enableMiddleware: true,
  storage: true,
  encrypt: true,
  encryptionKey: process.env.ENCRYPTION_KEY,
});

// Sync only authorized data between instances
function syncAuthorizedData(user) {
  if (!user) return;

  // Copy allowed data from private to public instance
  const userData = privateBullet.get(`users/${user.id}`).value();

  if (userData) {
    // Remove sensitive fields
    const { password, internalNotes, ssn, ...publicData } = userData;

    // Copy to public instance
    publicBullet.get(`users/${user.id}`).put(publicData);
  }

  // Copy allowed content
  if (user.role === "admin" || user.role === "editor") {
    const posts = privateBullet.get("posts").value();
    publicBullet.get("posts").put(posts);
  } else {
    // For regular users, only copy published posts
    const allPosts = privateBullet.get("posts").value() || {};
    const publishedPosts = {};

    for (const [id, post] of Object.entries(allPosts)) {
      if (post.status === "published") {
        publishedPosts[id] = post;
      }
    }

    publicBullet.get("posts").put(publishedPosts);
  }
}
```

## Network Level Security

### CORS Configuration

For browser-based applications using Bullet.js:

```javascript
// Set up CORS headers in your WebSocket server
const http = require("http");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "https://yourtrustedapp.com",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": 86400,
    });
    res.end();
    return;
  }

  // Other HTTP handlers...
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  // Check origin header
  const origin = req.headers.origin;

  if (origin !== "https://yourtrustedapp.com") {
    console.warn(`Connection attempt from untrusted origin: ${origin}`);
    ws.close(1008, "Unauthorized origin");
    return;
  }

  // Continue with WebSocket handling
  // ...
});

server.listen(8765);
```

### TLS Certificate Validation

For WebSocket clients:

```javascript
const WebSocket = require("ws");
const fs = require("fs");
const https = require("https");

// Create options with CA certificates for validation
const wsOptions = {
  agent: new https.Agent({
    ca: [fs.readFileSync("trusted-ca.pem")],
    checkServerIdentity: (host, cert) => {
      // Custom certificate validation logic
      // Return undefined for success or Error for failure
      const error = https.checkServerIdentity(host, cert);
      if (error) return error;

      // Additional custom checks
      if (cert.subject.CN !== "expected-hostname") {
        return new Error(`Invalid certificate CN: ${cert.subject.CN}`);
      }

      return undefined; // Certificate is valid
    },
  }),
};

// Connect with certificate validation
const ws = new WebSocket("wss://secure-server.example.com", wsOptions);
```

## Security Best Practices

### Key Management

Never hardcode secret keys:

```javascript
// BAD: Hardcoded keys
const bullet = new Bullet({
  encrypt: true,
  encryptionKey: "hardcoded-secret-key-123", // Never do this!
});

// GOOD: Environment variables
const bullet = new Bullet({
  encrypt: true,
  encryptionKey: process.env.ENCRYPTION_KEY,
});

// BETTER: Secure vault or key management service
const getEncryptionKey = async () => {
  try {
    // Example using AWS Secrets Manager
    const { SecretsManager } = require("@aws-sdk/client-secrets-manager");
    const client = new SecretsManager({ region: "us-east-1" });

    const response = await client.getSecretValue({
      SecretId: "bullet/encryption-key",
    });
    return response.SecretString;
  } catch (err) {
    console.error("Error retrieving encryption key:", err);
    process.exit(1); // Exit rather than run without proper security
  }
};

// Initialize with the securely retrieved key
getEncryptionKey().then((key) => {
  const bullet = new Bullet({
    encrypt: true,
    encryptionKey: key,
  });

  // Continue application startup
  startServer(bullet);
});
```

### Least Privilege Principle

```javascript
// Apply least privilege principle to peer connections
function configurePeerAccess(peer, role) {
  switch (role) {
    case "read-only":
      // Read-only peers can only subscribe to data
      peer.on("message", (message) => {
        if (message.type === "put" || message.type === "delete") {
          console.warn(`Read-only peer attempted ${message.type} operation`);
          return; // Ignore write/delete operations
        }

        // Process read operations normally
        // ...
      });
      break;

    case "local-only":
      // Local-only peers can't relay to other peers
      peer.on("message", (message) => {
        // Process the message but don't relay
        message.ttl = 0; // Prevent relaying
        // ...
      });
      break;

    case "full":
      // Full access peers have no restrictions
      break;
  }
}
```

### Regular Security Audits

Implement a security audit function:

```javascript
// Security self-check function
async function performSecurityAudit() {
  const issues = [];

  // Check for insecure configurations
  if (!bullet.options.encrypt) {
    issues.push({
      severity: 'high',
      issue: 'Storage encryption is disabled',
      recommendation: 'Enable storage encryption with a secure key'
    });
  }

  // Check peer connections
  const peers = bullet.network.peers;

  for (const [peerId, peer] of peers.entries()) {
    if (peer.url && !peer.url.startsWith('wss://')) {
      issues.push({
        severity: 'high',
        issue: `Unsecured WebSocket connection to peer ${peerId}`,
        recommendation: 'Use secure WebSockets (wss://) for all peer connections'
      });
    }
  }

  // Check for sensitive data
  const userData = bullet.get('users').value() || {};

  for (const [userId, user] of Object.entries(userData)) {
    if (user.password && typeof user.password === 'string' && !user.password.startsWith(')) {
      issues.push({
        severity: 'critical',
        issue: `Unhashed password found for user ${userId}`,
        recommendation: 'Store only hashed passwords with bcrypt or Argon2'
      });
    }
  }

  // Log and notify about findings
  if (issues.length > 0) {
    console.error(`Security audit found ${issues.length} issues:`);
    issues.forEach(issue => {
      console.error(`[${issue.severity.toUpperCase()}] ${issue.issue}`);
      console.error(`  Recommendation: ${issue.recommendation}`);
    });

    // Notify security team about critical issues
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    if (criticalIssues.length > 0) {
      notifySecurityTeam('critical_security_issues', { issues: criticalIssues });
    }
  } else {
    console.log('Security audit completed: No issues found');
  }

  return issues;
}

// Run automated security audits periodically
setInterval(performSecurityAudit, 24 * 60 * 60 * 1000);  // Daily audit
```

## Conclusion

Security in distributed databases requires a comprehensive approach. By implementing proper authentication, authorization, encryption, and monitoring, you can build secure Bullet.js applications that protect sensitive data while maintaining the collaborative, real-time nature of the database.

Remember that security is not a one-time setup but an ongoing process. Regularly review your security measures, stay informed about new threats and vulnerabilities, and update your security practices accordingly.

## Next Steps

Now that you've learned about securing Bullet.js applications, you might want to explore:

- [Performance Optimization](/docs/performance.md) - Optimize your Bullet.js applications
- [Deployment](/docs/deployment.md) - Deploy Bullet.js in production environments
- [Storage Adapters](/docs/storage-adapters.md) - Learn about secure storage options
- [Advanced Middleware](/docs/advanced-middleware.md) - Implement complex security patterns
