import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { fiMarket } from './markets/fi.js';

registerViesMarketTests(test, fiMarket);
