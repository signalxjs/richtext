/**
 * The @sigx/richtext-zero pane in a real browser: the zero toolbar edits the
 * shared source, the view switch shows the highlighted source beside the
 * rich text, and the skin switch swaps the design system's stylesheet.
 */
import { expect, test, type Page } from '@playwright/test';

// Caret movement is the browser's own, so it follows the host's key bindings (see editor.spec.ts).
const MAC_HOST = process.platform === 'darwin';
const LINE_START = MAC_HOST ? 'Meta+ArrowLeft' : 'Home';
const LINE_END = MAC_HOST ? 'Meta+ArrowRight' : 'End';

const zero = (page: Page) => page.locator('#zero-editor');
const serialized = (page: Page) => page.getByTestId('serialized-md');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('source').fill('hello world');
    await page.getByTestId('toggle-zero').check();
    await expect(zero(page).locator('[data-part="inline"][data-key="b-0"]')).toBeVisible();
});

test('the zero toolbar bolds the selection and shows it pressed', async ({ page }) => {
    const p = zero(page).locator('[data-part="inline"][data-key="b-0"]');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.press(`Shift+${LINE_START}`);
    // The main toolbar's item (the floating toolbar over the selection has one too).
    const bold = zero(page).locator('[data-scope="richtext-toolbar"][aria-label="Formatting"] [data-item="bold"]');
    await expect(bold).toHaveAttribute('data-scope', 'toggle');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(serialized(page)).toHaveText('**hello world**\n');
});

test('split shows the highlighted markdown; the format switch shows HTML', async ({ page }) => {
    await zero(page).getByRole('button', { name: 'Split' }).click();
    const pane = zero(page).locator('[data-scope="richtext-zero"][data-part="source"]');
    await expect(pane).toHaveAttribute('data-format', 'markdown');
    await expect(pane.locator('[data-part="line"]').first()).toContainText('hello world');
    await zero(page).getByRole('button', { name: 'HTML', exact: true }).click();
    await expect(pane).toHaveAttribute('data-format', 'html');
    await expect(pane.locator('[data-kind="tag"]').first()).toHaveText('<p>');
});

test('the skin switch swaps the design system', async ({ page }) => {
    await expect(page.locator('.pane-zero')).toHaveAttribute('data-skin', 'basic');
    const primary = () => zero(page).evaluate((el) => getComputedStyle(el).getPropertyValue('--color-primary').trim());
    const basic = await primary();
    await page.getByTestId('zero-skin').selectOption('daisyui');
    await expect(page.locator('.pane-zero')).toHaveAttribute('data-skin', 'daisyui');
    expect(await page.locator('link[data-zero-ds]').count()).toBe(1);
    expect(await primary()).not.toBe(basic);
});
