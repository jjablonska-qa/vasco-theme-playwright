import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { esMarket } from './markets/es.js';

registerViesMarketTests(test, esMarket);
