/** Current browser-local point workflow; catalog transport is intercepted. */
process.env.POINT_REVIEW_DEMO = '1';
await import('./point-review.browser.mjs');
