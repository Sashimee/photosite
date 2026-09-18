import { initSentry } from './common/monitoring/sentry-init.js';
import { loadEnv } from './config/env.js';

initSentry(loadEnv());
