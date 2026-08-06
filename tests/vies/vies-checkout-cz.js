import { test } from '@playwright/test';
import { registerViesMarketTests } from './core.js';
import { czMarket } from './markets/cz.js';

registerViesMarketTests(test, czMarket);
