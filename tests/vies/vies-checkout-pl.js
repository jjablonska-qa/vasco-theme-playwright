import { test } from '@playwright/test';
import { registerViesMarketTests } from './core.js';
import { plMarket } from './markets/pl.js';

registerViesMarketTests(test, plMarket);
