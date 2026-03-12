/**
 * Library for testing JSDoc injection.
 * These functions have NO type annotations — trickle will add JSDoc.
 */

function calculateTax(amount, rate) {
  const tax = amount * (rate / 100);
  return {
    amount,
    rate,
    tax,
    total: amount + tax,
  };
}

function formatUser(user, locale) {
  return {
    display: `${user.firstName} ${user.lastName}`,
    email: user.email.toLowerCase(),
    locale: locale || 'en-US',
  };
}

function filterItems(items, minValue) {
  const matching = items.filter(x => x > minValue);
  return {
    results: matching,
    count: matching.length,
    total: items.length,
  };
}

module.exports = { calculateTax, formatUser, filterItems };
