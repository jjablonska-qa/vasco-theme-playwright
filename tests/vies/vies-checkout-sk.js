import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { skMarket } from './markets/sk.js';

registerViesMarketTests(test, skMarket);
