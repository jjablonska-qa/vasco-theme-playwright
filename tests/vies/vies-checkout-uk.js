import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { ukMarket } from './markets/uk.js';

registerViesMarketTests(test, ukMarket);
