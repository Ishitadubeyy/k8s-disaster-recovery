import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWeatherCode, normalizeCity } from './weather.js';

test('normalizeCity trims whitespace and rejects invalid input', () => {
  assert.equal(normalizeCity('  New   York '), 'New York');
  assert.throws(() => normalizeCity(' '), { status: 400 });
  assert.throws(() => normalizeCity(42), { status: 400 });
  assert.throws(() => normalizeCity('a'.repeat(101)), { status: 400 });
});

test('describeWeatherCode maps Open-Meteo condition groups', () => {
  assert.deepEqual(describeWeatherCode(0), { condition: 'Clear sky', icon: 'clear' });
  assert.equal(describeWeatherCode(61).icon, 'rain');
  assert.equal(describeWeatherCode(71).icon, 'snow');
  assert.equal(describeWeatherCode(95).icon, 'storm');
  assert.equal(describeWeatherCode(999).icon, 'cloud');
});
