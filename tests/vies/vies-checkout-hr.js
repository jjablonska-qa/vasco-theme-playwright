import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { hrMarket } from './markets/hr.js';

registerViesMarketTests(test, hrMarket);
