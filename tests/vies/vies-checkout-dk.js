import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { dkMarket } from './markets/dk.js';

registerViesMarketTests(test, dkMarket);
