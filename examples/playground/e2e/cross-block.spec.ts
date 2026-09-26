/**
 * Selecting across blocks in a real browser: a drag leaving its block, Shift+
 * Arrow at a block edge and Shift+click all make one native selection over
 * several blocks (the content element becomes the editing host), and every
 * edit over it goes through the core's range commands.
 */
import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('#editor[data-part="root"]');
const content = (page: Page) => page.locator('#editor [data-part="content"]');
const block = (page: Page, key: string) => page.locator(`#editor [data-part="inline"][data-key="${key}"]`);
const blocks = (page: Page) => page.locator('#editor [data-part="inline"]');
const serialized = (page: Page) => page.getByTestId('serialized-md');

async function openEditor(page: Page, markdown: string): Promise<void> {
    await page.goto('/');
    await page.getByTestId('source').fill(markdown);
    await page.getByTestId('toggle-editor').check();
    await expect(editor(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

/**
 * A point at the very start / end of a block's text, relative to the block's box — handed to
 * Playwright's locator actions, which scroll the block into view and wait for it to be stable
 * (raw page coordinates go stale while a page still settles, and do in Firefox).
 */
async function edgeOf(page: Page, key: string, edge: 'start' | 'end'): Promise<{ x: number; y: number }> {
    return block(page, key).evaluate((el, e) => {
        const box = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = range.getClientRects();
        const r = e === 'start' ? rects[0] : rects[rects.length - 1];
        return { x: (e === 'start' ? r.left + 1 : r.right - 1) - box.left, y: r.top + r.height / 2 - box.top };
    }, edge);
}

/** Click at the very start / end of a block's text, optionally with Shift held. */
async function clickEdge(page: Page, key: string, edge: 'start' | 'end', modifiers: 'Shift'[] = []): Promise<void> {
    await block(page, key).click({ position: await edgeOf(page, key, edge), modifiers });
}

/** The editor's Mod key, decided the way the editor decides it (the emulated platform, not the host's). */
const modKey = (page: Page): Promise<string> =>
    page.evaluate(() => {
        const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
        return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent) ? 'Meta' : 'Control';
    });

test.beforeEach(async ({ page }) => {
    await openEditor(page, 'one\n\ntwo\n\nthree');
});

test('a drag across three paragraphs selects across them; Backspace joins the ends', async ({ page }) => {
    // Press near the start of the first block, move through the second, release inside the third.
    await block(page, 'b-0').hover({ position: { x: 4, y: (await edgeOf(page, 'b-0', 'start')).y } });
    await page.mouse.down();
    await block(page, 'b-1').hover();
    await block(page, 'b-2').hover({ position: { x: 12, y: (await edgeOf(page, 'b-2', 'start')).y } });
    await page.mouse.up();
    await expect(content(page)).toHaveAttribute('data-multi', '');
    await page.keyboard.press('Backspace');
    await expect(blocks(page)).toHaveCount(1);
    await expect(content(page)).not.toHaveAttribute('data-multi', '');
    const text = (await block(page, 'b-0').textContent())!;
    expect(text.length).toBeLessThan('onethree'.length);
    expect(text.endsWith('e')).toBe(true);
    await expect(block(page, 'b-0')).toBeFocused();
});

test('Shift+Down at the end of a block extends into the next; typing replaces the range', async ({ page }) => {
    await clickEdge(page, 'b-0', 'end');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(content(page)).toHaveAttribute('data-multi', '');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.type('X');
    await expect(blocks(page)).toHaveCount(1);
    await expect(block(page, 'b-0')).toHaveText(/^oneX/);
    // Typing continues in the joined block, and one undo brings the three blocks back.
    await page.keyboard.type('Y');
    await expect(block(page, 'b-0')).toHaveText(/^oneXY/);
    await page.keyboard.press(`${await modKey(page)}+z`);
    await expect(serialized(page)).toHaveText('one\n\ntwo\n\nthree');
});

test('Shift+click selects to another block; Mod-b bolds every block in the range', async ({ page }) => {
    await clickEdge(page, 'b-0', 'start');
    await clickEdge(page, 'b-2', 'end', ['Shift']);
    await expect(content(page)).toHaveAttribute('data-multi', '');
    const mod = await modKey(page);
    await page.keyboard.press(`${mod}+b`);
    await expect(serialized(page)).toHaveText('**one**\n\n**two**\n\n**three**');
    // The range survives the re-render and toggles back off.
    await page.keyboard.press(`${mod}+b`);
    await expect(serialized(page)).toHaveText('one\n\ntwo\n\nthree');
});

test('copy writes the range as markdown; paste over a range replaces it', async ({ page }) => {
    await clickEdge(page, 'b-0', 'start');
    await clickEdge(page, 'b-1', 'end', ['Shift']);
    const copied = await page.evaluate(() => {
        // Read the event's own clipboardData: Firefox copies the DataTransfer it is constructed with.
        const e = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
        document.activeElement!.dispatchEvent(e);
        return { plain: e.clipboardData!.getData('text/plain'), markdown: e.clipboardData!.getData('text/markdown') };
    });
    expect(copied.markdown).toBe('one\n\ntwo\n');
    await page.evaluate(() => {
        // A plain event carrying the data: Firefox empties a synthetic ClipboardEvent's DataTransfer.
        const dt = new DataTransfer();
        dt.setData('text/plain', 'pasted');
        const e = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: dt });
        document.activeElement!.dispatchEvent(e);
    });
    await expect(serialized(page)).toHaveText('pasted\n\nthree');
});

test('a range over a code block and a divider takes them whole', async ({ page }) => {
    await openEditor(page, 'one\n\n```\ncode\n```\n\n---\n\nfour');
    await clickEdge(page, 'b-0', 'end');
    await clickEdge(page, 'b-3', 'start', ['Shift']);
    await expect(page.locator('#editor [data-part="block"][data-in-range]')).toHaveCount(2);
    await page.keyboard.press('Delete');
    await expect(serialized(page)).toHaveText('onefour');
});

test('Escape turns a range into the block selection of its blocks; a click leaves it', async ({ page }) => {
    await clickEdge(page, 'b-0', 'start');
    await clickEdge(page, 'b-1', 'end', ['Shift']);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveAttribute('data-mode', 'block');
    await expect(page.locator('#editor [data-part="block"][data-selected]')).toHaveCount(2);
    await expect(content(page)).not.toHaveAttribute('data-multi', '');
    await clickEdge(page, 'b-2', 'end');
    await page.keyboard.type('!');
    await expect(serialized(page)).toHaveText('one\n\ntwo\n\nthree!');
});
