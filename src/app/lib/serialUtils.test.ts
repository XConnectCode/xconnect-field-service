import assert from 'node:assert';
import { getSerial } from './serialUtils';

assert.strictEqual(getSerial({ 'serial#': 'SN123' }), 'SN123');
assert.strictEqual(getSerial({ serial_number: 'SN456' }), 'SN456');
assert.strictEqual(getSerial({ serial: 'SN789' }), 'SN789');
assert.strictEqual(getSerial({ 'serial#': '', serial_number: 'SN456' }), 'SN456');
assert.strictEqual(getSerial({}), '');
assert.strictEqual(getSerial(null), '');
assert.strictEqual(getSerial(undefined), '');

console.log('serialUtils tests passed');
