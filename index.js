// Import core components
const Bullet = require("./src/bullet");

// Export the main class as default
module.exports = Bullet;

// Export individual components
module.exports.Network = require("./src/bullet-network");
module.exports.Storage = require("./src/bullet-storage");
module.exports.FileStorage = require("./src/bullet-file-storage");
module.exports.Query = require("./src/bullet-query");
module.exports.Validation = require("./src/bullet-validation");
module.exports.Middleware = require("./src/bullet-middleware");
module.exports.Serializer = require("./src/bullet-serializer");

// Export library version
module.exports.VERSION = "0.1.3";

// Simple factory function
module.exports.create = (options = {}) => new Bullet(options);
