import { describe, it, expect } from 'vitest';
import React from 'react';
import { App } from '../src/App';

describe('ZENTRA Web Foundation Smoke Tests', () => {
  it('instantiates App component without throwing', () => {
    const element = React.createElement(App);
    expect(element).toBeDefined();
    expect(element.type).toBe(App);
  });
});
