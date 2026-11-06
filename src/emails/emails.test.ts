import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leftoverPlaceholders, sanitizeEmailOutput } from './placeholders';
import { renderAllSamples } from './samples';
import { orderStatusUpdate } from './templates/orders';
import { enumLabel, formatDateAccra, formatTimeAccra } from './copy';

describe('email templates', () => {
  const samples = renderAllSamples();

  it('renders every sample without leftover placeholders', () => {
    assert.ok(samples.length >= 40);
    for (const email of samples) {
      assert.equal(leftoverPlaceholders(email.html).join(','), '', email.id);
      assert.equal(leftoverPlaceholders(email.text).join(','), '', email.id);
      assert.equal(leftoverPlaceholders(email.subject).join(','), '', email.id);
    }
  });

  it('does not send {{STATUS_MESSAGE}} on a pre-order status update', () => {
    const email = orderStatusUpdate(
      {
        order_number: 'ORD-003051126',
        customer_name: 'Batista',
        is_pre_order: true,
        pre_order_shipping_option: 'air_cargo',
        estimated_arrival_date: '2026-12-08',
        status: 'processing',
      },
      'processing'
    );
    assert.equal(email.html.includes('{{STATUS_MESSAGE}}'), false);
    assert.equal(email.text.includes('{{STATUS_MESSAGE}}'), false);
    assert.match(email.html, /Air cargo/);
    assert.match(email.html, /8 Dec 2026/);
    assert.match(email.subject, /ORD-003051126/);
  });

  it('throws in tests if a placeholder survives', () => {
    assert.throws(() => sanitizeEmailOutput('Hello {{STATUS_MESSAGE}}'), /STATUS_MESSAGE/);
  });

  it('strips leftovers in production instead of sending them', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(sanitizeEmailOutput('Hello {{STATUS_MESSAGE}} there'), 'Hello  there');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('keeps subjects under 60 characters and without emojis', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const email of samples) {
      assert.ok(email.subject.length <= 60, `${email.id}: ${email.subject} (${email.subject.length})`);
      assert.equal(emoji.test(email.subject), false, email.id);
      assert.equal(emoji.test(email.html), false, email.id);
      assert.equal(email.subject.includes('{{'), false, email.id);
    }
  });

  it('maps enums and formats Accra dates', () => {
    assert.equal(enumLabel('air_cargo'), 'Air cargo');
    assert.equal(enumLabel('processing'), 'Processing');
    assert.equal(formatDateAccra('2026-11-19T14:32:00.000Z'), '19 Nov 2026');
    assert.equal(formatTimeAccra('2026-11-19T14:32:00.000Z'), '14:32');
  });

  it('greets by first name and uses one primary button style colour', () => {
    const email = samples.find((item) => item.id === 'order-confirmation');
    assert.ok(email);
    assert.match(email.html, /Hi Kwame,/);
    assert.match(email.html, /#C2410C/);
    assert.match(email.html, /#1A1A1A/);
    assert.match(email.html, /View order ORD-003051126/);
    assert.match(email.text, /View order ORD-003051126/);
  });
});
