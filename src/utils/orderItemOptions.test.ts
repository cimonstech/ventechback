import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatOrderItemOptions, productNameWithOptions } from './orderItemOptions';

describe('formatOrderItemOptions', () => {
  it('formats current priced shape with attribute_name', () => {
    const selected = {
      '337799d0-70b6-49b3-8a87-df9e4e660e2a': {
        id: 'opt-1',
        attribute_name: 'Colour',
        name: 'Black',
        value: 'black',
        price_adjustment: 0,
      },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': {
        id: 'opt-2',
        attribute_name: 'Storage',
        name: '256 GB',
        value: '256gb',
        price_adjustment: 200,
      },
    };
    assert.equal(formatOrderItemOptions(selected), 'Colour: Black · Storage: 256 GB');
  });

  it('never shows uuid keys or [object Object] for old priced shape', () => {
    const selected = {
      '337799d0-70b6-49b3-8a87-df9e4e660e2a': {
        id: 'opt-1',
        name: 'Black',
        value: 'black',
        price_adjustment: 0,
      },
    };
    const text = formatOrderItemOptions(selected);
    assert.equal(text.includes('337799d0'), false);
    assert.equal(text.includes('[object Object]'), false);
    assert.equal(text, 'Black');
  });

  it('formats legacy string maps and arrays', () => {
    assert.equal(formatOrderItemOptions({ Colour: 'Black', Storage: '256 GB' }), 'Colour: Black · Storage: 256 GB');
    assert.equal(
      formatOrderItemOptions([{ attributeName: 'Colour', option: { label: 'Black' } }]),
      'Colour: Black'
    );
  });

  it('returns empty for unreadable values', () => {
    assert.equal(formatOrderItemOptions(null), '');
    assert.equal(formatOrderItemOptions({ '337799d0-70b6-49b3-8a87-df9e4e660e2a': {} }), '');
    assert.equal(formatOrderItemOptions({ x: { id: 'only-id' } }), '');
  });

  it('builds product names for emails/PDFs', () => {
    assert.equal(
      productNameWithOptions('iPhone 16', { Colour: 'Black' }),
      'iPhone 16 (Colour: Black)'
    );
  });
});
