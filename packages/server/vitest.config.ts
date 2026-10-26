import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        env: {
            DATABASE_URL: 'postgresql://app:app@localhost:5432/app_test',
            NODE_ENV: 'test',
            JWT_SECRET: 'test-only-secret-do-not-use-in-prod'
        }
    }
})