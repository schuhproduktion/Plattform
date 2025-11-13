// Basic smoke test for login + dashboard KPIs using Playwright.
// Requires E2E_USER_EMAIL and E2E_USER_PASSWORD env vars to run against a real instance.
const { test, expect } = require('@playwright/test');

const hasCredentials = process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD;

test.describe('Login & Dashboard KPIs', () => {
  test('user can log in and view KPI cards', async ({ page }) => {
    test.skip(!hasCredentials, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run this test');

    await page.goto('/login.html');
    await expect(page.locator('h1')).toHaveText(/BATE Supplier Portal/i);

    await page.fill('#email', process.env.E2E_USER_EMAIL);
    await page.fill('#password', process.env.E2E_USER_PASSWORD);

    await Promise.all([page.waitForURL('**/dashboard.html'), page.click('button[type="submit"]')]);

    await expect(page.locator('#kpiNewOrders')).toBeVisible();
    await expect(page.locator('#kpiOrderTickets')).toBeVisible();
    await expect(page.locator('#kpiTechpackTickets')).toBeVisible();
  });
});
