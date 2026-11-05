import './testenv';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import app from './app';
import { buildMixedCheckoutMetadata, checkoutMetadataSizeKb } from './services/checkoutMetadata.sample';

async function post(port: number, path: string, body: string, contentType = 'application/json') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': contentType,
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('request body limits', () => {
  let server: http.Server;
  let port: number;
  const metadata = buildMixedCheckoutMetadata(50);
  const fiftyItemKb = checkoutMetadataSizeKb({
    email: 'ama@example.test',
    reference: metadata.payment_reference,
    metadata,
  });

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    console.log(`50-item mixed checkout_data JSON size: ${fiftyItemKb.toFixed(1)} KB`);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('reports a 50-item mixed cart well under the 512kb JSON limit', () => {
    assert.ok(fiftyItemKb < 200, `expected 50-item cart under 200 KB, got ${fiftyItemKb}`);
  });

  it('accepts a 50-item cart JSON body (not 413)', async () => {
    const payload = JSON.stringify({
      email: 'ama@example.test',
      reference: metadata.payment_reference,
      metadata,
    });
    const result = await post(port, '/api/payments/initialize', payload);
    assert.notEqual(result.status, 413);
    const parsed = JSON.parse(result.body);
    assert.notEqual(parsed.message, 'This request is too large.');
  });

  it('returns 413 for a 600kb JSON body', async () => {
    const payload = JSON.stringify({ pad: 'a'.repeat(600 * 1024) });
    const result = await post(port, '/api/payments/initialize', payload);
    assert.equal(result.status, 413);
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.success, false);
    assert.equal(parsed.message, 'This request is too large.');
  });
});
