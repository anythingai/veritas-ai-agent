import { Pool } from 'pg';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

interface ApiKeyData {
  key: string;
  userId: string;
  organization: string;
  permissions: string[];
  tier: string;
  dailyQuota: number;
  monthlyQuota: number;
  rateLimit: number;
  isActive: boolean;
  expiresAt?: Date;
}

function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(16);
  const hex = randomBytes.toString('hex');
  return `veritas-${hex}`;
}

function generateUserId(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function seedApiKeys() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Connecting to database...');
    await pool.query('SELECT NOW()');

    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'researcher',
        api_key_hash VARCHAR(255) UNIQUE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create api_keys table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key_hash VARCHAR(255) UNIQUE NOT NULL,
        user_id UUID NOT NULL,
        organization VARCHAR(255) NOT NULL,
        permissions TEXT[] NOT NULL DEFAULT '{}',
        tier VARCHAR(50) NOT NULL DEFAULT 'free',
        daily_quota INTEGER NOT NULL DEFAULT 1000,
        monthly_quota INTEGER NOT NULL DEFAULT 30000,
        rate_limit INTEGER NOT NULL DEFAULT 50,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
    `);

    // Create api_key_usage table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_key_usage (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        usage_month VARCHAR(7) NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
        daily_usage INTEGER DEFAULT 0,
        monthly_usage INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(api_key_id, usage_date),
        UNIQUE(api_key_id, usage_month)
      );
    `);

    console.log('Database tables created/verified.');

    // Define API keys to seed
    const apiKeysToSeed: ApiKeyData[] = [
      {
        key: 'veritas-1234567890abcdef1234567890abcdef', // Testing key
        userId: generateUserId(),
        organization: 'test-org',
        permissions: ['read', 'verify'],
        tier: 'free',
        dailyQuota: 1000,
        monthlyQuota: 30000,
        rateLimit: 50,
        isActive: true
      },
      {
        key: generateApiKey(), // Production demo key
        userId: generateUserId(),
        organization: 'demo-org',
        permissions: ['read', 'verify'],
        tier: 'pro',
        dailyQuota: 5000,
        monthlyQuota: 150000,
        rateLimit: 100,
        isActive: true
      },
      {
        key: generateApiKey(), // Enterprise key
        userId: generateUserId(),
        organization: 'enterprise-org',
        permissions: ['read', 'verify', 'admin'],
        tier: 'enterprise',
        dailyQuota: 50000,
        monthlyQuota: 1500000,
        rateLimit: 500,
        isActive: true,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
      }
    ];

    console.log('Seeding API keys...');

    for (const apiKeyData of apiKeysToSeed) {
      // Create user first
      const userResult = await pool.query(`
        INSERT INTO users (id, email, name, role, is_active)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `, [
        apiKeyData.userId,
        `user-${apiKeyData.userId}@${apiKeyData.organization}.com`,
        `User ${apiKeyData.organization}`,
        apiKeyData.tier === 'enterprise' ? 'admin' : 'researcher',
        apiKeyData.isActive
      ]);

      // Hash the API key for storage
      const keyHash = crypto.createHash('sha256').update(apiKeyData.key).digest('hex');

      // Insert API key
      await pool.query(`
        INSERT INTO api_keys (
          key_hash, user_id, organization, permissions, tier,
          daily_quota, monthly_quota, rate_limit, is_active, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (key_hash) DO UPDATE SET
          organization = EXCLUDED.organization,
          permissions = EXCLUDED.permissions,
          tier = EXCLUDED.tier,
          daily_quota = EXCLUDED.daily_quota,
          monthly_quota = EXCLUDED.monthly_quota,
          rate_limit = EXCLUDED.rate_limit,
          is_active = EXCLUDED.is_active,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
      `, [
        keyHash,
        apiKeyData.userId,
        apiKeyData.organization,
        apiKeyData.permissions,
        apiKeyData.tier,
        apiKeyData.dailyQuota,
        apiKeyData.monthlyQuota,
        apiKeyData.rateLimit,
        apiKeyData.isActive,
        apiKeyData.expiresAt
      ]);

      console.log(`✅ API Key seeded for ${apiKeyData.organization} (${apiKeyData.tier}): ${apiKeyData.key}`);
    }

    console.log('\n🎉 API keys seeded successfully!');
    console.log('\nAPI Keys for testing:');
    apiKeysToSeed.forEach((key, index) => {
      console.log(`${index + 1}. ${key.organization} (${key.tier}): ${key.key}`);
    });

  } catch (error) {
    console.error('❌ Error seeding API keys:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the seeding script
if (require.main === module) {
  seedApiKeys().catch(console.error);
}

export { seedApiKeys }; 