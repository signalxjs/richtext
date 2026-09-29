/**
 * The Lab in a real browser: streaming through the Lab's own engine (block
 * identity, the final / open gutter, the engine inspector, pause and
 * resume), the whole-source view on the Round-trip tab, Shiki, the copy
 * button, `onLink` and the HTML source format.
 */
import { expect, test, type Page } from '@playwright/test';

/** `data-part` → count, for every descendant of `#<id>` (the root itself excluded). */
async function partCounts(page: Page, id: string): Promise<Record<string, number>> {
    return page.locator(`#${id} [data-part]`).evaluateAll((els) => {
        const counts: Record<string, number> = {};
        for (const el of els) {
            const part = el.getAttribute('data-part')!;
            counts[part] = (counts[part] ?? 0) + 1;
        }
        return counts;
    });
}

async function openRoundTrip(page: Page): Promise<void> {
    await page.getByTestId('tab-roundtrip').click();
    await expect(page.locator('#static[data-part="root"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#streamed[data-part="root"]')).toBeAttached();
});

test('renders the sample document', async ({ page }) => {
    await openRoundTrip(page);
    const view = page.locator('#static');
    await expect(view.locator('[data-part="heading"][data-depth="1"]')).toHaveText('@sigx/richtext playground');
    await expect(view.locator('[data-part="table"]')).toHaveCount(1);
    await expect(view.locator('[data-part="code"][data-lang="ts"]')).toHaveCount(1);
    // The mention plugin is on by default: `@[Andy](u1)` renders through the app's slot.
    await expect(view.locator('[data-part="mention"]')).toHaveText('@Andy');
    // A task list renders checkboxes.
    await expect(view.locator('[data-part="list-item"][data-task]')).toHaveCount(3);
    // Serializing the sample is a fixed point.
    await expect(page.getByTestId('roundtrip')).toHaveText('round-trips');
});

test('streaming keeps block identity, marks final blocks and ends with the static structure', async ({ page }) => {
    await expect(page.getByTestId('stream-status')).toHaveText('idle');
    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('streaming');

    // Tag the first paragraph as soon as the live parse produces it.
    const firstParagraph = page.locator('#streamed [data-part="paragraph"]').first();
    await expect(firstParagraph).toBeAttached();
    await firstParagraph.evaluate((el) => {
        (el as HTMLElement & { __probe?: number }).__probe = 1;
    });

    // Mid-stream the heading and the paragraph are final; the block being written is the open tail.
    await expect(page.locator('#streamed [data-block-state="final"]').first()).toBeAttached();
    await expect(page.locator('#streamed [data-block-state="open"]')).toHaveCount(1);

    // The whole sample streams in ~9s at 3 chars / 16ms.
    await expect(page.getByTestId('stream-status')).toHaveText('done', { timeout: 30_000 });

    // Same element: the block was finalized in place, never re-mounted.
    const probe = await firstParagraph.evaluate((el) => (el as HTMLElement & { __probe?: number }).__probe);
    expect(probe).toBe(1);

    // The inspector lists every top-level block the view shows, and agrees with it on which are final.
    const gutters = page.locator('#streamed > [data-block-state]');
    const rows = page.getByTestId('engine-blocks').locator('tbody tr');
    await expect(rows).toHaveCount(await gutters.count());
    await expect(page.getByTestId('engine-finalized')).toHaveText(String(await page.locator('#streamed > [data-block-state="final"]').count()));
    expect(Number(await page.getByTestId('engine-cut').textContent())).toBeGreaterThan(0);

    // And the streamed tree is structurally the whole source's tree.
    const streamed = await partCounts(page, 'streamed');
    const streamedText = await page.locator('#streamed').innerText();
    await openRoundTrip(page);
    expect(streamed).toEqual(await partCounts(page, 'static'));
    expect(streamedText).toBe(await page.locator('#static').innerText());
});

test('pause holds the stream where it is and resume carries on', async ({ page }) => {
    await page.getByTestId('tick-ms').fill('40');
    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('streaming');
    await expect(page.locator('#streamed [data-part="heading"]').first()).toBeAttached();

    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('paused');
    await expect(page.getByTestId('stream-start')).toHaveText('Resume');
    const held = await page.getByTestId('stream-count').textContent();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('stream-count')).toHaveText(held!);
    // The source pane shows the cut where the stream stopped.
    await expect(page.getByTestId('source-cut')).toBeAttached();

    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('streaming');
    await expect(page.getByTestId('stream-count')).not.toHaveText(held!);

    // Restart begins again from nothing.
    await page.getByTestId('stream-restart').click();
    await expect(page.getByTestId('stream-status')).toHaveText('streaming');
    await expect(page.locator('#streamed [data-block-state]').first()).toBeAttached();
});

test('Shiki highlights the ts fence when toggled on', async ({ page }) => {
    await openRoundTrip(page);
    const body = page.locator('#static [data-part="code"][data-lang="ts"] [data-part="code-body"]');
    await expect(body.locator('span[data-line]')).toHaveCount(0);

    await page.getByTestId('toggle-shiki').check();

    // shiki (and its grammars) load lazily on the first toggle.
    await expect(body.locator('span[data-line]').first()).toBeAttached({ timeout: 20_000 });
    expect(await body.locator('span[data-line]').count()).toBeGreaterThanOrEqual(4);
    expect(await body.locator('span[data-line] span[style*="color"]').count()).toBeGreaterThan(0);
    // Highlighting never changes the text.
    await expect(body).toContainText('export function greet(name: string): string {');
});

test('the copy button puts the fence content on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openRoundTrip(page);

    const block = page.locator('#static [data-part="code"][data-lang="ts"]');
    const expected = await block.locator('[data-part="code-body"]').evaluate((el) => el.textContent);
    expect(expected).toContain('export function greet');

    const button = block.locator('[data-part="copy"]');
    await expect(button).toHaveText('Copy');
    await button.click();
    await expect(button).toHaveText('Copied');

    // Chromium on Windows hands plain text to the system clipboard with CRLF
    // line endings; the component wrote exactly `value`.
    const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(clipboard).toBe(expected);
});

test('onLink intercepts link clicks instead of navigating', async ({ page }) => {
    await openRoundTrip(page);
    const before = page.url();
    const link = page.locator('#static [data-part="link"]').first();
    const href = await link.getAttribute('href');
    expect(href).toBe('https://sigx.dev/markdown/');

    await link.click();

    await expect(page.getByTestId('last-link')).toHaveText('https://sigx.dev/markdown/');
    expect(page.url()).toBe(before);
    // Still the same document — nothing navigated.
    await expect(page.locator('#static[data-part="root"]')).toBeVisible();
});

test('HTML as the source format renders the same document, and converts back', async ({ page }) => {
    await openRoundTrip(page);
    const markdownParts = await partCounts(page, 'static');

    await page.getByTestId('format-html').click();
    await expect(page.getByTestId('source')).toHaveValue(/^<h1>@sigx\/richtext playground<\/h1>/);
    const view = page.locator('#static');
    await expect(view.locator('[data-part="heading"][data-depth="1"]')).toHaveText('@sigx/richtext playground');
    await expect(view.locator('[data-part="mention"]')).toHaveText('@Andy');
    expect(await partCounts(page, 'static')).toEqual(markdownParts);

    await page.getByTestId('format-markdown').click();
    await expect(page.getByTestId('source')).toHaveValue(/^# @sigx\/richtext playground/);
    expect(await partCounts(page, 'static')).toEqual(markdownParts);
});

test('the HTML source streams through the re-parse engine', async ({ page }) => {
    await page.getByTestId('sample').selectOption('chat');
    await page.getByTestId('format-html').click();
    await page.getByTestId('chars-per-tick').fill('40');
    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('done', { timeout: 20_000 });
    // Nothing is ever final without an incremental engine.
    await expect(page.getByTestId('engine-finalized')).toHaveText('0');
    await expect(page.locator('#streamed [data-block-state="final"]')).toHaveCount(0);
    await expect(page.locator('#streamed [data-part="mention"]')).toHaveText('@Bea');
});
