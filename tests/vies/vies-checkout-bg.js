import { test } from '@playwright/test';
import { registerViesMarketTests } from './core.js';
import { bgMarket } from './markets/bg.js';

registerViesMarketTests(test, bgMarket);
