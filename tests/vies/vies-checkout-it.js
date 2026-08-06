import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { itMarket } from './markets/it.js';

registerViesMarketTests(test, itMarket);
