import { test } from '@playwright/test';
import { registerViesMarketTests } from './core.js';
import { deMarket } from './markets/de.js';

registerViesMarketTests(test, deMarket);
