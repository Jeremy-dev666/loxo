import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/swarmdev',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwtSecret: () => required('JWT_SECRET'),
  secretsKey: () => required('SECRETS_KEY'),
  /** Control-plane URL handed to agent runtimes; override when agents run off-host. */
  mcpUrl: () =>
    process.env.MCP_PUBLIC_URL ?? `http://127.0.0.1:${Number(process.env.PORT ?? 4000)}/mcp`,
};

/** Fails fast at boot; individual modules use the lazy getters above. */
export function assertRequiredEnv(): void {
  config.jwtSecret();
  config.secretsKey();
}
