import { test } from '@playwright/test';

import { registerViesMarketTests } from './core.js';
import { frMarket } from './markets/fr.js';

registerViesMarketTests(test, frMarket);
