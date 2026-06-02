// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { port } from './config/env';

// Listen on all interfaces (0.0.0.0) to accept connections from localhost
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 VENTECH API Server running on port ${port}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: http://localhost:${port}`);
  console.log(`🌐 Listening on 0.0.0.0:${port} (all interfaces)`);
});

