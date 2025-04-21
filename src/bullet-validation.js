/**
 * Bullet-Validation.js - Data validation and schema enforcement for Bullet.js
 */

class BulletValidation {
  constructor(bullet) {
    this.bullet = bullet;

    // Store for schemas
    this.schemas = {};

    // Map of paths to schema names
    this.pathSchemas = {};

    // Error handlers
    this.errorHandlers = {
      validation: [],
      type: [],
      required: [],
      format: [],
      custom: [],
      all: [],
    };

    // Initialize validation hooks
    this._initValidation();
  }

  /**
   * Initialize validation by setting up data write hooks
   * @private
   */
  _initValidation() {
    // Save original _setData method
    const originalSetData = this.bullet._setData.bind(this.bullet);

    // Override _setData to validate data before writing
    this.bullet._setData = (
      path,
      data,
      timestamp = Date.now(),
      broadcast = true
    ) => {
      try {
        // Check if path has a schema
        const isValid = this._validateDataForPath(path, data);

        if (isValid) {
          // Call original method if valid
          originalSetData(path, data, timestamp, broadcast);
        } else {
          // Data is invalid, don't save
          console.error(`Validation failed for path: ${path}`);
        }
      } catch (error) {
        // Handle validation errors
        this._handleError(error);

        // Decide whether to proceed based on error severity
        if (!error.isFatal) {
          originalSetData(path, data, timestamp, broadcast);
        }
      }
    };
  }

  /**
   * Define a schema
   * @param {string} name - Schema name
   * @param {Object} schema - Schema definition
   * @return {BulletValidation} - This instance for chaining
   * @public
   */
  defineSchema(name, schema) {
    // Validate schema definition itself
    if (!schema || typeof schema !== "object") {
      throw new Error("Schema must be an object");
    }

    // Store the schema
    this.schemas[name] = this._normalizeSchema(schema);

    console.log(`Schema '${name}' defined`);
    return this;
  }

  /**
   * Normalize a schema definition for internal use
   * @param {Object} schema - Raw schema definition
   * @return {Object} - Normalized schema
   * @private
   */
  _normalizeSchema(schema) {
    const normalized = {
      type: schema.type || "object",
      properties: {},
      required: schema.required || [],
      additionalProperties: schema.additionalProperties !== false,
      validators: schema.validators || [],
    };

    // Process property definitions
    if (schema.properties && typeof schema.properties === "object") {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        // Recursively normalize nested schemas
        if (propSchema.type === "object" && propSchema.properties) {
          normalized.properties[propName] = this._normalizeSchema(propSchema);
        } else {
          normalized.properties[propName] = {
            type: propSchema.type || "any",
            required: propSchema.required || false,
            default: propSchema.default,
            validators: propSchema.validators || [],
            format: propSchema.format,
            enum: propSchema.enum,
            min: propSchema.min,
            max: propSchema.max,
            pattern: propSchema.pattern ? new RegExp(propSchema.pattern) : null,
          };
        }
      }
    }

    return normalized;
  }

  /**
   * Apply a schema to a path
   * @param {string} path - Path to apply schema to
   * @param {string} schemaName - Name of schema to apply
   * @return {BulletValidation} - This instance for chaining
   * @public
   */
  applySchema(path, schemaName) {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema '${schemaName}' does not exist`);
    }

    this.pathSchemas[path] = schemaName;
    console.log(`Schema '${schemaName}' applied to path '${path}'`);

    return this;
  }

  /**
   * Remove schema from a path
   * @param {string} path - Path to remove schema from
   * @return {BulletValidation} - This instance for chaining
   * @public
   */
  removeSchema(path) {
    delete this.pathSchemas[path];
    console.log(`Schema removed from path '${path}'`);

    return this;
  }

  /**
   * Validate data against a schema
   * @param {string} schemaName - Name of schema to validate against
   * @param {*} data - Data to validate
   * @return {boolean} - Whether data is valid
   * @throws {ValidationError} - If validation fails
   * @public
   */
  validate(schemaName, data) {
    const schema = this.schemas[schemaName];

    if (!schema) {
      throw new Error(`Schema '${schemaName}' does not exist`);
    }

    return this._validateAgainstSchema(schema, data, schemaName);
  }

  /**
   * Validate data for a specific path
   * @param {string} path - Path to validate for
   * @param {*} data - Data to validate
   * @return {boolean} - Whether data is valid
   * @private
   */
  _validateDataForPath(path, data) {
    // Find applicable schema for this path
    let schemaPath = null;
    let schemaName = null;

    // Check direct path match
    if (this.pathSchemas[path]) {
      schemaPath = path;
      schemaName = this.pathSchemas[path];
    } else {
      // Check parent paths
      const parts = path.split("/").filter(Boolean);

      while (parts.length > 0) {
        const parentPath = parts.join("/");

        if (this.pathSchemas[parentPath]) {
          schemaPath = parentPath;
          schemaName = this.pathSchemas[parentPath];
          break;
        }

        parts.pop();
      }
    }

    // No schema found for this path
    if (!schemaPath || !schemaName) {
      return true;
    }

    const schema = this.schemas[schemaName];

    if (!schema) {
      console.warn(`Schema '${schemaName}' not found for path '${path}'`);
      return true;
    }

    try {
      // If this is a child path of the schema path, validate just this property
      if (path !== schemaPath) {
        const relativePath = path.slice(schemaPath.length + 1);
        const propertyPath = relativePath.split("/").filter(Boolean);

        // Handle nested property validation
        if (propertyPath.length > 0) {
          return this._validateNestedProperty(schema, propertyPath, data);
        }
      }

      // Otherwise validate entire object
      return this._validateAgainstSchema(schema, data, schemaName);
    } catch (error) {
      this._handleError(error);
      return false;
    }
  }

  /**
   * Validate a nested property against a schema
   * @param {Object} schema - Schema to validate against
   * @param {Array} propertyPath - Path to property
   * @param {*} data - Data to validate
   * @return {boolean} - Whether data is valid
   * @private
   */
  _validateNestedProperty(schema, propertyPath, data) {
    const [prop, ...rest] = propertyPath;

    // Find property schema
    const propSchema = schema.properties[prop];

    if (!propSchema) {
      // If additionalProperties is false, this is an error
      if (schema.additionalProperties === false) {
        throw this._createError(
          "validation",
          `Property '${prop}' is not defined in the schema and additionalProperties is false`,
          false
        );
      }

      // Otherwise, it's allowed
      return true;
    }

    // If this is a nested path, recurse
    if (rest.length > 0) {
      if (propSchema.type !== "object") {
        throw this._createError(
          "type",
          `Expected '${prop}' to be an object but it's defined as '${propSchema.type}'`,
          false
        );
      }

      return this._validateNestedProperty(propSchema, rest, data);
    }

    // Validate the value against the property schema
    return this._validateValue(propSchema, data, prop);
  }

  /**
   * Validate data against a complete schema
   * @param {Object} schema - Schema to validate against
   * @param {*} data - Data to validate
   * @param {string} schemaName - Name of schema (for error reporting)
   * @return {boolean} - Whether data is valid
   * @throws {ValidationError} - If validation fails
   * @private
   */
  _validateAgainstSchema(schema, data, schemaName) {
    // Type validation
    if (schema.type && !this._checkType(data, schema.type)) {
      throw this._createError(
        "type",
        `Expected ${schemaName} to be ${schema.type} but got ${typeof data}`,
        false
      );
    }

    // If not an object, no further validation needed
    if (typeof data !== "object" || data === null) {
      return true;
    }

    // Required properties
    for (const required of schema.required) {
      if (!(required in data)) {
        throw this._createError(
          "required",
          `Missing required property: ${required}`,
          true
        );
      }
    }

    // Validate each property
    for (const [propName, propValue] of Object.entries(data)) {
      // Check if property is defined in schema
      if (propName in schema.properties) {
        const propSchema = schema.properties[propName];

        if (!this._validateValue(propSchema, propValue, propName)) {
          return false;
        }
      } else if (schema.additionalProperties === false) {
        // Additional properties not allowed
        throw this._createError(
          "validation",
          `Unknown property: ${propName}`,
          false
        );
      }
    }

    // Run custom validators for the entire object
    for (const validator of schema.validators) {
      try {
        const isValid = validator(data);

        if (!isValid) {
          throw this._createError(
            "custom",
            `Custom validation failed for ${schemaName}`,
            false
          );
        }
      } catch (error) {
        if (!error.isValidationError) {
          // Wrap normal errors in a validation error
          throw this._createError(
            "custom",
            `Custom validator error: ${error.message}`,
            false,
            error
          );
        }
        throw error;
      }
    }

    return true;
  }

  /**
   * Validate a single value against a property schema
   * @param {Object} propSchema - Property schema
   * @param {*} value - Value to validate
   * @param {string} propName - Property name (for error reporting)
   * @return {boolean} - Whether value is valid
   * @private
   */
  _validateValue(propSchema, value, propName) {
    // If value is undefined but property has a default, it's valid
    if (value === undefined && "default" in propSchema) {
      return true;
    }

    // Required check
    if (propSchema.required && (value === undefined || value === null)) {
      throw this._createError(
        "required",
        `Property ${propName} is required`,
        true
      );
    }

    // If value is undefined or null, no further validation needed
    if (value === undefined || value === null) {
      return true;
    }

    // Type validation
    if (propSchema.type && !this._checkType(value, propSchema.type)) {
      throw this._createError(
        "type",
        `Expected ${propName} to be ${propSchema.type} but got ${typeof value}`,
        false
      );
    }

    // Enum validation
    if (propSchema.enum && Array.isArray(propSchema.enum)) {
      if (!propSchema.enum.includes(value)) {
        throw this._createError(
          "validation",
          `Value of ${propName} must be one of [${propSchema.enum.join(", ")}]`,
          false
        );
      }
    }

    // Min/max validation for numbers
    if (propSchema.type === "number" || propSchema.type === "integer") {
      if (typeof propSchema.min === "number" && value < propSchema.min) {
        throw this._createError(
          "validation",
          `Value of ${propName} must be at least ${propSchema.min}`,
          false
        );
      }

      if (typeof propSchema.max === "number" && value > propSchema.max) {
        throw this._createError(
          "validation",
          `Value of ${propName} must be at most ${propSchema.max}`,
          false
        );
      }
    }

    // Pattern validation for strings
    if (propSchema.type === "string" && propSchema.pattern) {
      if (!propSchema.pattern.test(value)) {
        throw this._createError(
          "format",
          `Value of ${propName} does not match required pattern`,
          false
        );
      }
    }

    // Format validation for strings
    if (propSchema.type === "string" && propSchema.format) {
      if (!this._checkFormat(value, propSchema.format)) {
        throw this._createError(
          "format",
          `Value of ${propName} does not match format ${propSchema.format}`,
          false
        );
      }
    }

    // Min/max length for strings and arrays
    if (
      (propSchema.type === "string" || propSchema.type === "array") &&
      typeof propSchema.min === "number" &&
      value.length < propSchema.min
    ) {
      throw this._createError(
        "validation",
        `Length of ${propName} must be at least ${propSchema.min}`,
        false
      );
    }

    if (
      (propSchema.type === "string" || propSchema.type === "array") &&
      typeof propSchema.max === "number" &&
      value.length > propSchema.max
    ) {
      throw this._createError(
        "validation",
        `Length of ${propName} must be at most ${propSchema.max}`,
        false
      );
    }

    // For objects, recursively validate
    if (
      propSchema.type === "object" &&
      typeof value === "object" &&
      value !== null
    ) {
      return this._validateAgainstSchema(propSchema, value, propName);
    }

    // Custom validators
    for (const validator of propSchema.validators) {
      try {
        const isValid = validator(value);

        if (!isValid) {
          throw this._createError(
            "custom",
            `Custom validation failed for ${propName}`,
            false
          );
        }
      } catch (error) {
        if (!error.isValidationError) {
          // Wrap normal errors in a validation error
          throw this._createError(
            "custom",
            `Custom validator error for ${propName}: ${error.message}`,
            false,
            error
          );
        }
        throw error;
      }
    }

    return true;
  }

  /**
   * Check if a value matches a specified type
   * @param {*} value - Value to check
   * @param {string} type - Type to check against
   * @return {boolean} - Whether value matches type
   * @private
   */
  _checkType(value, type) {
    switch (type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "integer":
        return (
          typeof value === "number" && Number.isInteger(value) && !isNaN(value)
        );
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      case "null":
        return value === null;
      case "any":
        return true;
      default:
        return false;
    }
  }

  /**
   * Check if a string matches a specified format
   * @param {string} value - String to check
   * @param {string} format - Format to check against
   * @return {boolean} - Whether string matches format
   * @private
   */
  _checkFormat(value, format) {
    switch (format) {
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      case "url":
        try {
          new URL(value);
          return true;
        } catch (e) {
          return false;
        }
      case "date":
        return !isNaN(Date.parse(value));
      case "date-time":
        return !isNaN(Date.parse(value));
      case "uuid":
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value
        );
      case "ipv4":
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
      case "ipv6":
        return /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/.test(
          value
        );
      default:
        return true;
    }
  }

  /**
   * Create a validation error
   * @param {string} type - Error type
   * @param {string} message - Error message
   * @param {boolean} isFatal - Whether error is fatal
   * @param {Error} originalError - Original error (if any)
   * @return {Error} - Validation error
   * @private
   */
  _createError(type, message, isFatal, originalError = null) {
    const error = new Error(message);
    error.isValidationError = true;
    error.type = type;
    error.isFatal = isFatal;
    error.originalError = originalError;

    return error;
  }

  /**
   * Handle a validation error
   * @param {Error} error - Error to handle
   * @private
   */
  _handleError(error) {
    if (!error.isValidationError) {
      console.error("Non-validation error:", error);
      return;
    }

    // Call type-specific handlers
    if (error.type && this.errorHandlers[error.type]) {
      this.errorHandlers[error.type].forEach((handler) => {
        try {
          handler(error);
        } catch (e) {
          console.error("Error in validation error handler:", e);
        }
      });
    }

    // Call global handlers
    this.errorHandlers["all"].forEach((handler) => {
      try {
        handler(error);
      } catch (e) {
        console.error("Error in validation error handler:", e);
      }
    });
  }

  /**
   * Register an error handler
   * @param {string} type - Error type to handle ('all' for all errors)
   * @param {Function} handler - Handler function
   * @return {BulletValidation} - This instance for chaining
   * @public
   */
  onError(type, handler) {
    if (typeof handler !== "function") {
      throw new Error("Error handler must be a function");
    }

    if (!this.errorHandlers[type]) {
      this.errorHandlers[type] = [];
    }

    this.errorHandlers[type].push(handler);

    return this;
  }
}

module.exports = BulletValidation;
