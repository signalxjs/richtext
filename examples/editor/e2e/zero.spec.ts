/**
 * The showcase in a real browser: the zero toolbar edits the bound source,
 * the view switch shows the highlighted source beside the rich text, and the
 * bar swaps the design system and its theme.
 */
import { expect, test, type Page } from '@playwright/test';

// Caret movement is the browser's own, so it follows the host's key bindings (see the Lab's editor.spec.ts).
const MAC_HOST = process.platform === 'darwin';
const LINE_START = MAC_HOST ? 'Meta+ArrowLeft' : 'Home';
const LINE_END = MAC_HOST ? 'Meta+ArrowRight' : 'End';

const zero = (page: Page) => page.locator('#zero-editor');
const serialized = (page: Page) => page.getByTestId('serialized-md');
const html = (page: Page) => page.locator('html');
/** A token the skin defines: it changes with the design system and with the theme. */
const token = (page: Page, name: string) => zero(page).evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

test.beforeEach(async ({ page }) => {
    await page.goto('/?doc=hello%20world');
    await expect(zero(page).locator('[data-part="inline"][data-key="b-0"]')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-skin', 'basic');
});

test('opens with the sample document', async ({ page }) => {
    await page.goto('/');
    await expect(zero(page).locator('[data-part="inline"][data-type="heading"]').first()).toHaveText('Streaming renderer');
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

test('the design system picker swaps the stylesheet', async ({ page }) => {
    const basic = await token(page, '--color-primary');
    await page.getByTestId('skin-daisyui').check();
    await expect(html(page)).toHaveAttribute('data-skin', 'daisyui');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect(await page.locator('link[data-zero-ds]').count()).toBe(1);
    expect(await token(page, '--color-primary')).not.toBe(basic);
});

test('the theme switch flips to the skin’s dark theme and back', async ({ page }) => {
    await expect(html(page)).toHaveAttribute('data-theme', 'basic');
    const light = await token(page, '--color-base-100');
    await page.getByTestId('toggle-dark').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'basic-dark');
    expect(await token(page, '--color-base-100')).not.toBe(light);

    // The dark choice survives a skin switch: daisyUI comes up in its own dark theme.
    await page.getByTestId('skin-daisyui').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('toggle-dark').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
});
