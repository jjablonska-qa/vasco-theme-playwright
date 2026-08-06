import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { seMarket } from './markets/se.js';

registerViesMarketTests(test, seMarket);
