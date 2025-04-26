# Data Validation

Bullet.js includes a powerful validation system that helps ensure data integrity by validating data against schemas before it's stored in the database.

## You will learn

- How to define schemas for your data
- How to apply schemas to paths in your database
- How to validate data manually
- How to handle validation errors
- How to create custom validators

## Why Use Validation?

Validation helps maintain data quality and consistency across your distributed database. Benefits include:

- Preventing invalid data from entering your database
- Ensuring required fields are present
- Enforcing data types and formats
- Applying custom business rules
- Improving security by rejecting malformed input

## Enabling Validation

Validation is enabled by default, but you can explicitly configure it:

```javascript
const bullet = new Bullet({
  enableValidation: true, // default is true
});
```

## Defining Schemas

Schemas define the structure and constraints for your data. They specify required fields, data types, and validation rules.

### Basic Schema Definition

```javascript
// Define a schema for user data
bullet.defineSchema("user", {
  type: "object",
  required: ["username", "email", "createdAt"],
  properties: {
    username: {
      type: "string",
      min: 3,
      max: 20,
      pattern: "^[a-zA-Z0-9_]+$", // Only alphanumeric and underscore
    },
    email: {
      type: "string",
      format: "email",
    },
    age: {
      type: "integer",
      min: 13,
      max: 120,
    },
    role: {
      type: "string",
      enum: ["user", "admin", "editor"],
    },
    verified: {
      type: "boolean",
    },
    profile: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        bio: { type: "string", max: 500 },
      },
    },
    interests: {
      type: "array",
      min: 1,
      max: 10,
    },
    createdAt: {
      type: "string",
      format: "date-time",
    },
  },
});
```

### Schema Types

Bullet.js supports these types in schemas:

- `string`: Text data
- `number`: Floating-point numbers
- `integer`: Whole numbers
- `boolean`: True/false values
- `array`: Ordered collections of items
- `object`: Structured data with properties
- `null`: Null values
- `any`: Any data type (bypass type checking)

### Validation Rules

Common validation rules include:

- `required`: Array of required property names
- `type`: Data type for validation
- `min`/`max`:
  - For numbers: Minimum/maximum value
  - For strings: Minimum/maximum length
  - For arrays: Minimum/maximum number of items
- `pattern`: Regular expression for string validation
- `format`: Predefined formats (email, date, url, etc.)
- `enum`: List of allowed values
- `additionalProperties`: Whether to allow properties not in the schema

## Applying Schemas to Paths

To use a schema, apply it to a path in your database:

```javascript
// Apply the 'user' schema to the 'users' path
bullet.applySchema("users", "user");

// Now any data stored at users/* will be validated
// against the 'user' schema

// This will pass validation
bullet.get("users/alice").put({
  username: "alice_doe",
  email: "alice@example.com",
  age: 28,
  role: "admin",
  verified: true,
  profile: {
    firstName: "Alice",
    lastName: "Doe",
    bio: "Software engineer",
  },
  interests: ["coding", "hiking"],
  createdAt: new Date().toISOString(),
});

// This will fail validation (invalid email)
bullet.get("users/invalid").put({
  username: "invalid_user",
  email: "not-an-email",
  createdAt: new Date().toISOString(),
});
```

## Handling Validation Errors

You can register handlers for validation errors:

```javascript
// General validation error handler
bullet.onValidationError("all", (error) => {
  console.error(`Validation Error: ${error.message}`);
});

// Specific error type handlers
bullet.onValidationError("required", (error) => {
  console.error(`Missing required field: ${error.message}`);
});

bullet.onValidationError("type", (error) => {
  console.error(`Type error: ${error.message}`);
});

bullet.onValidationError("format", (error) => {
  console.error(`Format error: ${error.message}`);
});
```

## Custom Validators

For complex validation rules, you can add custom validator functions:

```javascript
bullet.defineSchema("user", {
  type: "object",
  required: ["username", "email"],
  properties: {
    // ... basic properties ...
    password: { type: "string" },
    passwordConfirm: { type: "string" },
  },
  // Custom validator for complex rules
  validators: [
    function (user) {
      // Ensure passwords match
      if (user.password !== user.passwordConfirm) {
        throw new Error("Passwords do not match");
      }

      // Admin users must be verified
      if (user.role === "admin" && user.verified !== true) {
        throw new Error("Admin users must be verified");
      }

      return true;
    },
  ],
});
```

## Validating Nested Properties

Schemas can validate deeply nested properties:

```javascript
// Define a schema with nested objects
bullet.defineSchema("article", {
  type: "object",
  required: ["title", "content", "author"],
  properties: {
    title: { type: "string", min: 5, max: 100 },
    content: { type: "string", min: 50 },
    published: { type: "boolean", default: false },
    author: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        bio: { type: "string" },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    metadata: {
      type: "object",
      properties: {
        views: { type: "integer", min: 0 },
        rating: { type: "number", min: 0, max: 5 },
      },
    },
  },
});

// Apply schema
bullet.applySchema("articles", "article");

// Update just the nested metadata
bullet.get("articles/123/metadata/views").put(42); // Will be validated
```

## Manual Validation

You can manually validate data without storing it:

```javascript
// Check if data conforms to a schema
const userData = {
  username: "test_user",
  email: "test@example.com",
  createdAt: new Date().toISOString(),
};

try {
  const isValid = bullet.validate("user", userData);
  if (isValid) {
    console.log("Data is valid!");
  }
} catch (error) {
  console.error("Validation failed:", error.message);
}
```

## Removing Schemas

You can remove a schema when it's no longer needed:

```javascript
// Remove schema from a path
bullet.validation.removeSchema("users");
```

## Complete Example

Here's a full example showing how to use validation in a real application:

```javascript
const Bullet = require("bullet-js");

// Initialize Bullet with validation
const bullet = new Bullet({
  enableValidation: true,
});

// Set up validation error handlers
bullet.onValidationError("all", (error) => {
  console.error(`Validation Error: ${error.message}`);
});

// Define a product schema
bullet.defineSchema("product", {
  type: "object",
  required: ["name", "price"],
  properties: {
    name: { type: "string", min: 1 },
    price: { type: "number", min: 0.01 },
    description: { type: "string" },
    category: { type: "string" },
    inStock: { type: "boolean" },
    tags: { type: "array" },
  },
});

// Apply schema to products
bullet.applySchema("products", "product");

// Valid product will be stored
try {
  bullet.get("products/laptop").put({
    name: "Gaming Laptop",
    price: 1299.99,
    description: "High-performance gaming laptop",
    category: "electronics",
    inStock: true,
    tags: ["gaming", "laptop", "electronics"],
  });
  console.log("Product created successfully");
} catch (error) {
  console.error("Error creating product:", error);
}

// Invalid product (negative price) will fail validation
try {
  bullet.get("products/invalid").put({
    name: "Invalid Product",
    price: -10.0,
    category: "test",
  });
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Expected error:", error);
}

// Display final state
console.log("Products:", bullet.get("products").value());
```

## Next Steps

Now that you've learned about validation, you might want to explore:

- [Middleware](/docs/middleware) - Add custom behavior to read and write operations
- [Querying](/docs/querying) - Learn how to filter and search your data
- [Advanced Validation](/docs/advanced-validation) - Advanced validation techniques and patterns
