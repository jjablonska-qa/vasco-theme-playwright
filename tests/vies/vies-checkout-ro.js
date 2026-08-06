import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { roMarket } from './markets/ro.js';

registerViesMarketTests(test, roMarket);
