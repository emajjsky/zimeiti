const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'content-engine-development-only-secret-change-me');

if (!jwtSecret) throw new Error('生产环境必须设置 JWT_SECRET。');

module.exports = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || 'postgres://content_engine:content_engine@127.0.0.1:5432/content_engine',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5173',
  encryptionSecret: process.env.CREDENTIAL_ENCRYPTION_KEY || (isProduction ? '' : crypto.createHash('sha256').update(jwtSecret).digest('base64')),
  isProduction,
};
