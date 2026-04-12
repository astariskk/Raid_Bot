// index.js

import './bootstrap/env.js';
import { startBot } from './bootstrap/startBot.js';

startBot().catch((error) => {
  console.error('[startup] startBot() failed:', error);
  console.error('[startup] stack:', error?.stack);
  const exitOnFatal =
    !['1', 'true', 'yes'].includes(String(process.env.DISABLE_PROCESS_EXIT ?? '').toLowerCase());
  if (exitOnFatal) process.exit(1);
});
