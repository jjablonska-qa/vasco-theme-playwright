import { test } from '@playwright/test';
import { registerViesMarketTests } from './core.js';
import { beFrMarket } from './markets/be-fr.js';

registerViesMarketTests(test, beFrMarket);
