/**
 * Validation utilities for P2P Server
 * Provides input validation functions
 */

/**
 * Validate a data path
 * @param {string} path - Data path to validate
 * @returns {boolean} - Whether path is valid
 */
function isValidPath(path) {
  // Path must be a non-empty string
  if (typeof path !== "string" || path.trim() === "") {
    return false;
  }

  // Path should not contain invalid characters
  const invalidChars = ["#", "?", "\\", '"', "<", ">", "|", "*", ":"];
  if (invalidChars.some((char) => path.includes(char))) {
    return false;
  }

  // Path should not start or end with whitespace
  if (path.trim() !== path) {
    return false;
  }

  // Path should not have consecutive slashes
  if (path.includes("//")) {
    return false;
  }

  return true;
}

/**
 * Normalize a data path
 * @param {string} path - Data path to normalize
 * @returns {string} - Normalized path
 */
function normalizePath(path) {
  // Trim whitespace
  let normalizedPath = path.trim();

  // Remove leading/trailing slashes
  while (normalizedPath.startsWith("/")) {
    normalizedPath = normalizedPath.substring(1);
  }
  while (normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.substring(0, normalizedPath.length - 1);
  }

  return normalizedPath;
}

/**
 * Validate a data value
 * @param {any} value - Value to validate
 * @returns {boolean} - Whether value is valid
 */
function isValidValue(value) {
  // Null is allowed (for deletions)
  if (value === null) {
    return true;
  }

  try {
    // Test if value can be serialized and deserialized
    const serialized = JSON.stringify(value);
    JSON.parse(serialized);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate a peer URL
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether URL is valid
 */
function isValidPeerUrl(url) {
  // URL must be a string
  if (typeof url !== "string") {
    return false;
  }

  try {
    // Attempt to parse URL
    const parsedUrl = new URL(url);

    // Must be HTTP or HTTPS
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate a port number
 * @param {number} port - Port to validate
 * @returns {boolean} - Whether port is valid
 */
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Create a validator function that throws on invalid input
 * @param {Function} validationFn - Validation function
 * @param {string} errorMessage - Error message on failure
 * @returns {Function} - Validator function
 */
function createValidator(validationFn, errorMessage) {
  return (value) => {
    if (!validationFn(value)) {
      throw new Error(errorMessage);
    }
    return value;
  };
}

module.exports = {
  isValidPath,
  normalizePath,
  isValidValue,
  isValidPeerUrl,
  isValidPort,
  createValidator,

  // Pre-created validators
  validatePath: createValidator(
    isValidPath,
    "Invalid path: must be a non-empty string without special characters"
  ),
  validateValue: createValidator(
    isValidValue,
    "Invalid value: must be serializable to JSON"
  ),
  validatePeerUrl: createValidator(
    isValidPeerUrl,
    "Invalid peer URL: must be a valid HTTP or HTTPS URL"
  ),
  validatePort: createValidator(
    isValidPort,
    "Invalid port: must be an integer between 1 and 65535"
  ),
};
