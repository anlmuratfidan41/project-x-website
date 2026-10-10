import 'dotenv/config';
import { app } from './app.js';
import { seedOwner } from './database.js';
import { alertOperators, recordError } from './monitoring.js';

const port = Number(process.env.PORT ?? 4000);

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('Unhandled promise rejection:', reason);
  recordError('server', `Unhandled rejection: ${message}`, reason instanceof Error ? reason.stack ?? '' : '');
  void alertOperators('unhandled-rejection', `background task failed: ${message}`.slice(0, 300));
});

// A crash leaves the process in an unknown state: record it, try to alert, then exit so the host restarts the server.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception, shutting down:', error);
  recordError('server', `Server crashed: ${error.message}`, error.stack ?? '');
  const exit = () => process.exit(1);
  setTimeout(exit, 5000).unref();
  alertOperators('crash', `the server crashed and is restarting: ${error.message}`.slice(0, 300)).finally(exit);
});

await seedOwner();
app.listen(port, () => console.info(`Project X API listening on http://localhost:${port}`));
