import 'dotenv/config';
import express from 'express';
import { env } from './env.js';
import { prisma } from './db.js';

const app = express();

app.get('/health', (_req, res ) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
})

process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    process.exit(0);
})