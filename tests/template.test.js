import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, encodeSubject } from '../src/template.js';

test('substitutes template variables', () => assert.equal(renderTemplate('Hi {{ name }} at {{company}}', { name: 'Ada', company: 'Acme' }), 'Hi Ada at Acme'));
test('keeps missing variables visible', () => assert.equal(renderTemplate('Hi {{name}}', {}), 'Hi {{name}}'));
test('leaves nested/malformed braces unchanged', () => { assert.equal(renderTemplate('{{{name}}}', { name: 'Ada' }), '{{{name}}}'); assert.equal(renderTemplate('{{name', { name: 'Ada' }), '{{name'); });
test('RFC 2047 encodes non-ASCII subjects', () => assert.match(encodeSubject('你好'), /^=\?UTF-8\?B\?.+\?=$/));
