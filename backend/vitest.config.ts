import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: {
      JWT_SECRET: 'test-jwt-secret',
      SECRETS_KEY: 'oGkxLXhSTGGdzenXWYyLW9leHnJHUzlXY1YyY3ZJdEU=',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5434/swarmdev_test',
    },
    fileParallelism: false,
  },
});
