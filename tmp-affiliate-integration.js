const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const token = jwt.sign({ sub: 'a1e918da-4363-4596-9721-94f1606077b8', email: 'jahkor360@gmail.com', role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const client = axios.create({ baseURL: 'http://localhost:5000/api/affiliate', headers: { Authorization: `Bearer ${token}` } });
const endpoints = [
  { method: 'get', url: '/test' },
  { method: 'get', url: '/dashboard/stats' },
  { method: 'get', url: '/dashboard/chart-data' },
  { method: 'get', url: '/dashboard/recent-earnings' },
  { method: 'get', url: '/links' },
  { method: 'get', url: '/payouts/summary' },
  { method: 'get', url: '/products' }
];
(async () => {
  for (const ep of endpoints) {
    try {
      const res = await client.request({ method: ep.method, url: ep.url });
      console.log('OK', ep.url, res.status, JSON.stringify(res.data, null, 2).slice(0, 800));
    } catch (err) {
      console.error('ERR', ep.url, err.response ? err.response.status : err.message, err.response ? err.response.data : '');
    }
  }
})();
