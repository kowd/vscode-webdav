import {describe, expect, test} from '@jest/globals';
const x = require('./extension');

describe('sum module', () => {
  test('adds 1 + 2 to equal 3', () => {
    expect(1 + 2).toBe(3);
  });
});