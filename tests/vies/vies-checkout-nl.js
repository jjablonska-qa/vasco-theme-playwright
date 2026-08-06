import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { nlMarket } from './markets/nl.js';

registerViesMarketTests(test, nlMarket);
