import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { ptMarket } from './markets/pt.js';

registerViesMarketTests(test, ptMarket);
