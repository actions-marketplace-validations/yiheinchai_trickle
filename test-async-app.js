/**
 * App that uses async functions for testing async type generation.
 */
require('trickle/auto');

const { fetchUser, searchProducts, formatPrice, ApiClient } = require('./test-async-lib');

async function main() {
  const user = await fetchUser('u123');
  console.log('user:', user.name);

  const products = await searchProducts('widget', 10);
  console.log('products:', products.total);

  const price = formatPrice(19.99, '$');
  console.log('price:', price.formatted);

  const client = new ApiClient();
  const profile = await client.getProfile('u456');
  console.log('profile:', profile.displayName);

  const comment = await client.postComment('p789', 'Great post!');
  console.log('comment:', comment.commentId);

  const version = client.getVersion();
  console.log('version:', version.version);
}

main().then(() => console.log('Done!'));
