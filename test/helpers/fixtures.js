/**
 * Test fixtures for P2P server tests
 */

/**
 * Generate test user data
 * @param {number} [count=10] - Number of users to generate
 * @returns {Array<Object>} - Array of user objects
 */
function generateUsers(count = 10) {
  const users = [];

  for (let i = 1; i <= count; i++) {
    users.push({
      id: `user${i}`,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      role: i % 3 === 0 ? "admin" : "user",
      created: Date.now() - i * 86400000, // Days ago
    });
  }

  return users;
}

/**
 * Generate test product data
 * @param {number} [count=20] - Number of products to generate
 * @returns {Array<Object>} - Array of product objects
 */
function generateProducts(count = 20) {
  const categories = ["Electronics", "Clothing", "Books", "Home", "Sports"];
  const products = [];

  for (let i = 1; i <= count; i++) {
    const category = categories[i % categories.length];
    const price = 10 + i * 5;
    const stock = 10 + i * 2;

    products.push({
      id: `product${i}`,
      name: `Product ${i}`,
      category,
      price,
      stock,
      onSale: i % 4 === 0,
      created: Date.now() - i * 43200000, // 12 hour intervals
    });
  }

  return products;
}

/**
 * Generate system settings
 * @returns {Object} - Settings object
 */
function generateSettings() {
  return {
    system: {
      theme: "light",
      maxConnections: 100,
      apiKey: "test-key-12345",
      timeout: 30000,
      debug: false,
    },
    network: {
      syncInterval: 60000,
      retryCount: 3,
      retryDelay: 5000,
    },
    security: {
      allowGuests: true,
      maxLoginAttempts: 5,
      sessionTimeout: 3600000,
    },
  };
}

/**
 * Load fixture data into a server
 * @param {Object} server - P2P server instance
 * @param {Object} options - Options for which fixtures to load
 * @param {boolean} [options.users=true] - Whether to load user fixtures
 * @param {boolean} [options.products=true] - Whether to load product fixtures
 * @param {boolean} [options.settings=true] - Whether to load settings fixtures
 * @returns {Promise<Object>} - Summary of loaded fixtures
 */
async function loadFixtures(server, options = {}) {
  const opts = {
    users: true,
    products: true,
    settings: true,
    ...options,
  };

  const summary = {};

  // Load users
  if (opts.users) {
    const users = generateUsers();
    summary.users = users.length;

    for (const user of users) {
      await server.put(`users/${user.id}`, user);
    }
  }

  // Load products
  if (opts.products) {
    const products = generateProducts();
    summary.products = products.length;

    for (const product of products) {
      await server.put(`products/${product.id}`, product);
    }
  }

  // Load settings
  if (opts.settings) {
    const settings = generateSettings();
    summary.settings = Object.keys(settings).length;

    for (const [category, values] of Object.entries(settings)) {
      await server.put(`settings/${category}`, values);
    }
  }

  return summary;
}

module.exports = {
  generateUsers,
  generateProducts,
  generateSettings,
  loadFixtures,
};
