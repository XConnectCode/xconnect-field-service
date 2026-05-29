import assert from 'node:assert';
import { buildAuthHeader, buildUserAuthHeader } from './authHeader.core';

const ANON = 'anon-key';
const USER = 'user-jwt';

// buildAuthHeader: prefers a real user token, falls back to anon for
// unauthenticated public reads.
assert.deepStrictEqual(buildAuthHeader(USER, ANON), {
  Authorization: `Bearer ${USER}`,
});
assert.deepStrictEqual(buildAuthHeader(null, ANON), {
  Authorization: `Bearer ${ANON}`,
});
assert.deepStrictEqual(buildAuthHeader(undefined, ANON), {
  Authorization: `Bearer ${ANON}`,
});
assert.deepStrictEqual(buildAuthHeader('', ANON), {
  Authorization: `Bearer ${ANON}`,
});

// buildUserAuthHeader: refuses to fall back. Returns null when there is no
// signed-in user so destructive-call sites don't accidentally hit the
// backend with the anon key.
assert.deepStrictEqual(buildUserAuthHeader(USER), {
  Authorization: `Bearer ${USER}`,
});
assert.strictEqual(buildUserAuthHeader(null), null);
assert.strictEqual(buildUserAuthHeader(undefined), null);
assert.strictEqual(buildUserAuthHeader(''), null);

console.log('authHeader tests passed');
