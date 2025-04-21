/**
 * Bullet.js Validation Example
 */

const Bullet = require("../src/bullet");

// Initialize a Bullet instance with validation enabled
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: false, // Disable storage for this example
  enableValidation: true,
});

// Setup error logging
bullet.onValidationError("all", (error) => {
  console.error(`Validation Error: ${error.message}`);
});

// More specific error handlers
bullet.onValidationError("required", (error) => {
  console.error(`Missing required field: ${error.message}`);
});

bullet.onValidationError("type", (error) => {
  console.error(`Type error: ${error.message}`);
});

// Define a user schema
console.log("Defining user schema...");
bullet.defineSchema("user", {
  type: "object",
  required: ["username", "email", "createdAt"],
  additionalProperties: false, // Don't allow fields not in the schema
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
  // Custom validator for complex rules
  validators: [
    function (user) {
      // Example: Admin users must be verified
      if (user.role === "admin" && user.verified !== true) {
        throw new Error("Admin users must be verified");
      }
      return true;
    },
  ],
});

// Define a product schema
console.log("Defining product schema...");
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

// Apply schemas to paths
bullet.applySchema("users", "user");
bullet.applySchema("products", "product");

console.log("\n--- VALIDATION EXAMPLES ---\n");

// Example 1: Valid user
console.log("1. Creating a valid user:");
const validUser = {
  username: "john_doe",
  email: "john@example.com",
  age: 30,
  role: "user",
  verified: true,
  profile: {
    firstName: "John",
    lastName: "Doe",
    bio: "Regular user",
  },
  interests: ["sports", "technology"],
  createdAt: new Date().toISOString(),
};

try {
  const isValid = bullet.validate("user", validUser);
  console.log(`Validation result: ${isValid}`);
  bullet.get("users/john_doe").put(validUser);
  console.log("User created successfully");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 2: Invalid user (missing required field)
console.log("\n2. Creating an invalid user (missing email):");
const invalidUser1 = {
  username: "missing_email",
  // email field is missing
  age: 25,
  role: "user",
  verified: true,
  createdAt: new Date().toISOString(),
};

try {
  bullet.get("users/missing_email").put(invalidUser1);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 3: Invalid user (wrong type)
console.log("\n3. Creating an invalid user (age is not an integer):");
const invalidUser2 = {
  username: "wrong_age",
  email: "wrong@example.com",
  age: "twenty", // Wrong type, should be integer
  role: "user",
  verified: true,
  createdAt: new Date().toISOString(),
};

try {
  bullet.get("users/wrong_age").put(invalidUser2);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 4: Invalid format
console.log("\n4. Creating an invalid user (invalid email format):");
const invalidUser3 = {
  username: "bad_email",
  email: "not-an-email", // Invalid email format
  age: 40,
  role: "user",
  verified: true,
  createdAt: new Date().toISOString(),
};

try {
  bullet.get("users/bad_email").put(invalidUser3);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 5: Invalid enum value
console.log("\n5. Creating an invalid user (invalid role):");
const invalidUser4 = {
  username: "bad_role",
  email: "role@example.com",
  age: 35,
  role: "superuser", // Not in enum
  verified: true,
  createdAt: new Date().toISOString(),
};

try {
  bullet.get("users/bad_role").put(invalidUser4);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 6: Custom validator error
console.log("\n6. Creating an invalid user (admin must be verified):");
const invalidUser5 = {
  username: "unverified_admin",
  email: "admin@example.com",
  age: 45,
  role: "admin",
  verified: false, // Admin must be verified
  createdAt: new Date().toISOString(),
};

try {
  bullet.get("users/unverified_admin").put(invalidUser5);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 7: Valid product
console.log("\n7. Creating a valid product:");
const validProduct = {
  name: "Gaming Laptop",
  price: 1299.99,
  description: "High-performance gaming laptop",
  category: "electronics",
  inStock: true,
  tags: ["gaming", "laptop", "electronics"],
};

try {
  bullet.get("products/laptop").put(validProduct);
  console.log("Product created successfully");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 8: Invalid product (negative price)
console.log("\n8. Creating an invalid product (negative price):");
const invalidProduct = {
  name: "Invalid Product",
  price: -10.0, // Price can't be negative
  description: "This should fail validation",
  category: "test",
};

try {
  bullet.get("products/invalid").put(invalidProduct);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 9: Updating nested property
console.log("\n9. Updating a nested property:");
try {
  // This should work fine
  bullet.get("users/john_doe/profile/bio").put("Updated bio information");
  console.log("Bio updated successfully");

  // This should fail (too long)
  const longBio = "A".repeat(600);
  bullet.get("users/john_doe/profile/bio").put(longBio);
  console.log("This should not be displayed due to validation error");
} catch (error) {
  console.error("Unexpected error:", error);
}

// Example 10: Removing schema
console.log("\n10. Removing schema and trying invalid data:");
bullet.validation.removeSchema("products");
const invalidProduct2 = {
  name: "No Schema Product",
  price: -20.0, // This would be invalid with schema
};

try {
  bullet.get("products/no-schema").put(invalidProduct2);
  console.log("Product created successfully after schema removal");
} catch (error) {
  console.error("Unexpected error:", error);
}

console.log("\nFinal data state:");
console.log("Users:", Object.keys(bullet.store.users || {}));
console.log("Products:", Object.keys(bullet.store.products || {}));

// Clean up
bullet.close();
console.log("\nAll validation examples completed.");
