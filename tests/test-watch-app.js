/**
 * Simple app used by test-run-watch-e2e.js.
 * Contains a function that will be modified during the watch test.
 */

function greet(name) {
  return { message: `Hello, ${name}!`, length: name.length };
}

const result = greet("World");
console.log(result.message);
console.log("Done!");
