import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { ltMarket } from './markets/lt.js';

registerViesMarketTests(test, ltMarket);
