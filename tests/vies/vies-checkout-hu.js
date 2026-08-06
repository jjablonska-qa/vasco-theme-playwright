import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { huMarket } from './markets/hu.js';

registerViesMarketTests(test, huMarket);
