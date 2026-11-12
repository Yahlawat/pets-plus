// Which terminal commands count as running tests. Kept out of extension.js so
// test/care.test.js can check it without VS Code.
exports.TEST_RE = /\b(pytest|py\.test|jest|vitest|mocha|rspec|phpunit|ctest|unittest|nose2|tox)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(go|cargo|dotnet|mix|swift)\s+test\b|\bmake\s+(test|check)\b/;
