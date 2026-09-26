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
    // The tests click at measured coordinates: let fonts and layout settle first.
    await page.evaluate(() => document.fonts.ready);
    await block(page, 'b-0').scrollIntoViewIfNeeded();
}

/** Click at the very start / end of a block's text (Shift held for a Shift+click: `mouse.click` takes no modifiers). */
async function clickEdge(page: Page, key: string, edge: 'start' | 'end', modifiers: 'Shift'[] = []): Promise<void> {
    const text = await block(page, key).evaluate((el, e) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = range.getClientRects();
        const r = e === 'start' ? rects[0] : rects[rects.length - 1];
        return { x: e === 'start' ? r.left + 1 : r.right - 1, y: r.top + r.height / 2 };
    }, edge);
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(text.x, text.y);
    for (const m of modifiers) await page.keyboard.up(m);
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
    const first = (await block(page, 'b-0').boundingBox())!;
    const last = (await block(page, 'b-2').boundingBox())!;
    await page.mouse.move(first.x + 4, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 40, last.y + last.height / 2, { steps: 12 });
    await page.mouse.move(last.x + 12, last.y + last.height / 2, { steps: 6 });
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
        const dt = new DataTransfer();
        document.activeElement!.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
        return { plain: dt.getData('text/plain'), markdown: dt.getData('text/markdown') };
    });
    expect(copied.markdown).toBe('one\n\ntwo\n');
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'pasted');
        document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
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
