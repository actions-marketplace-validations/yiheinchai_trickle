/**
 * Library with async functions for testing async type generation.
 */

async function fetchUser(id) {
  return { id, name: 'Alice', email: 'alice@example.com', active: true };
}

async function searchProducts(query, limit) {
  return {
    results: [{ id: 1, name: 'Widget', price: 9.99 }],
    total: 1,
    query,
  };
}

function formatPrice(amount, currency) {
  return { formatted: `${currency}${amount.toFixed(2)}`, amount, currency };
}

class ApiClient {
  async getProfile(userId) {
    return { userId, displayName: 'Bob', role: 'admin' };
  }

  async postComment(postId, text) {
    return { commentId: 42, postId, text, createdAt: '2026-01-01' };
  }

  getVersion() {
    return { version: '1.0.0', build: 123 };
  }
}

module.exports = { fetchUser, searchProducts, formatPrice, ApiClient };
