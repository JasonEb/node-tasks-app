import { z } from 'zod';

const schema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Missing or invalid environment variables - see above.');
}

export const env = parsed.data;