import { config } from './config.js';
import { migrate, pool, waitForDb } from './db.js';
import { seed } from './seed.js';
import { buildApp } from './app.js';

async function main() {
  await waitForDb();
  await migrate();
  await seed();
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
