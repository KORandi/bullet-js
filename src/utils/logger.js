/**
 * Logger utility for P2P Server
 * Provides consistent logging across the application
 */

const fs = require("fs");
const path = require("path");

class Logger {
  /**
   * Create a new Logger
   * @param {Object} options - Logger options
   * @param {string} [options.level='info'] - Minimum log level ('debug', 'info', 'warn', 'error')
   * @param {string} [options.logFile] - Optional file to write logs to
   * @param {boolean} [options.console=true] - Whether to output to console
   * @param {boolean} [options.timestamp=true] - Whether to include timestamps
   */
  constructor(options = {}) {
    this.level = options.level || "info";
    this.logFile = options.logFile;
    this.console = options.console !== false;
    this.timestamp = options.timestamp !== false;

    // Define log level priorities
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    // Set up file logging if specified
    if (this.logFile) {
      this.setupLogFile();
    }
  }

  /**
   * Setup log file
   * @private
   */
  setupLogFile() {
    try {
      const dir = path.dirname(this.logFile);

      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Ensure file exists
      if (!fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, "");
      }
    } catch (error) {
      console.error(`Failed to set up log file: ${error.message}`);
      this.logFile = null;
    }
  }

  /**
   * Log a message
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} [metadata] - Additional metadata
   */
  log(level, message, metadata = {}) {
    // Skip if level is below threshold
    if (this.levels[level] < this.levels[this.level]) {
      return;
    }

    // Format log entry
    const timestamp = this.timestamp ? new Date().toISOString() : "";
    const formattedMetadata =
      metadata && Object.keys(metadata).length > 0
        ? JSON.stringify(metadata)
        : "";

    const logEntry = `${
      timestamp ? `[${timestamp}] ` : ""
    }[${level.toUpperCase()}] ${message}${
      formattedMetadata ? ` ${formattedMetadata}` : ""
    }`;

    // Output to console if enabled
    if (this.console) {
      switch (level) {
        case "error":
          console.error(logEntry);
          break;
        case "warn":
          console.warn(logEntry);
          break;
        case "debug":
          console.debug(logEntry);
          break;
        default:
          console.log(logEntry);
      }
    }

    // Write to file if enabled
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, logEntry + "\n");
      } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
      }
    }
  }

  /**
   * Log a debug message
   * @param {string} message - Log message
   * @param {Object} [metadata] - Additional metadata
   */
  debug(message, metadata) {
    this.log("debug", message, metadata);
  }

  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {Object} [metadata] - Additional metadata
   */
  info(message, metadata) {
    this.log("info", message, metadata);
  }

  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {Object} [metadata] - Additional metadata
   */
  warn(message, metadata) {
    this.log("warn", message, metadata);
  }

  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {Object} [metadata] - Additional metadata
   */
  error(message, metadata) {
    this.log("error", message, metadata);
  }
}

// Create default instance
const defaultLogger = new Logger();

module.exports = {
  Logger,
  defaultLogger,

  // Factory function to create a new logger
  createLogger: (options) => new Logger(options),
};
