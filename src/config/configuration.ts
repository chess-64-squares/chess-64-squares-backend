export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  /** "host:port" pairs for read replicas; empty in dev */
  replicaHosts: Array<{ host: string; port: number }>;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
}

export interface EmailConfig {
  /** unset ⇒ dev-log provider (verification links printed to the backend log) */
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress: string;
  /** base URL the verification links point at (the web app) */
  frontendBaseUrl: string;
  verificationTtlHours: number;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  postgres: PostgresConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  email: EmailConfig;
  disconnectGraceSec: number;
  runMigrations: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export default function configuration(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const accessSecret = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me';
  const refreshSecret = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me';
  if (nodeEnv === 'production' && (accessSecret.includes('change-me') || refreshSecret.includes('change-me'))) {
    throw new Error('JWT secrets must be set in production (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET)');
  }

  return {
    nodeEnv,
    port: int(process.env.BACKEND_PORT, 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    postgres: {
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: int(process.env.POSTGRES_PORT, 5432),
      user: process.env.POSTGRES_USER ?? 'chess64',
      password: process.env.POSTGRES_PASSWORD ?? 'chess64_dev_password',
      db: process.env.POSTGRES_DB ?? 'chess64',
      replicaHosts: (process.env.POSTGRES_REPLICA_HOSTS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [host, port] = pair.split(':');
          return { host: host!, port: int(port, 5432) };
        }),
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: int(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    jwt: {
      accessSecret,
      refreshSecret,
      accessTtlSec: int(process.env.JWT_ACCESS_TTL_SEC, 900),
      refreshTtlSec: int(process.env.JWT_REFRESH_TTL_SEC, 2_592_000),
    },
    email: {
      smtpHost: process.env.SMTP_HOST || undefined,
      smtpPort: int(process.env.SMTP_PORT, 587),
      smtpUser: process.env.SMTP_USER || undefined,
      smtpPassword: process.env.SMTP_PASSWORD || undefined,
      fromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'chess-64-squares <no-reply@localhost>',
      frontendBaseUrl: (process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
      verificationTtlHours: int(process.env.EMAIL_VERIFICATION_TTL_HOURS, 24),
    },
    disconnectGraceSec: int(process.env.DISCONNECT_GRACE_SEC, 60),
    runMigrations: process.env.RUN_MIGRATIONS === 'true',
  };
}
