/**
 * The block editor in a real browser: typing through contenteditable,
 * input rules, Enter/Backspace across blocks, arrows across a code block,
 * undo, the toolbar, block selection, the block menu, slash commands,
 * mentions and markdown paste — every path that happy-dom cannot drive
 * with real key events and layout.
 */
import { expect, test, type Page } from '@playwright/test';

/*
 * Caret movement and select-all are the browser's own, so they follow the HOST's key bindings (macOS
 * has no Home/End in text, and selects all with Meta), while editor chords (Control+z, …) follow the
 * emulated Windows user agent of Playwright's Desktop Chrome profile.
 */
const MAC_HOST = process.platform === 'darwin';
const LINE_START = MAC_HOST ? 'Meta+ArrowLeft' : 'Home';
const LINE_END = MAC_HOST ? 'Meta+ArrowRight' : 'End';
const SELECT_ALL = MAC_HOST ? 'Meta+a' : 'Control+a';

const editor = (page: Page) => page.locator('#editor[data-part="root"]');
const block = (page: Page, key: string) => page.locator(`#editor [data-part="inline"][data-key="${key}"]`);
/** The markdown the editor wrote back: the serializer pane renders `toMarkdown(parseMarkdown(source))`. */
const serialized = (page: Page) => page.getByTestId('serialized-md');

async function openEditor(page: Page, markdown = ''): Promise<void> {
    await page.goto('/');
    // Seed the source through the textarea, then switch the pane to the editor bound to it.
    await page.getByTestId('source').fill(markdown);
    await page.getByTestId('toggle-editor').check();
    await expect(editor(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await openEditor(page, 'hello');
});

test('typing in a paragraph writes back to the bound source and the view follows', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.type(' world');
    await expect(p).toHaveText('hello world');
    await expect(serialized(page)).toHaveText('hello world');
    await expect(page.locator('#static [data-part="paragraph"]')).toHaveText('hello world');
});

test('input rules: "# " makes a heading and **bold** becomes strong as it is typed', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_START);
    await page.keyboard.type('# ');
    const h = block(page, 'b-0');
    await expect(h).toHaveJSProperty('tagName', 'H1');
    await expect(h).toHaveText('hello');
    await page.keyboard.press(LINE_END);
    await page.keyboard.type(' **big**');
    await expect(h.locator('strong')).toHaveText('big');
    await expect(serialized(page)).toHaveText('# hello **big**');
});

test('Enter splits, Backspace at the start joins, and the caret follows', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(block(page, 'b-1')).toHaveText('lo');
    await expect(block(page, 'b-1')).toBeFocused();
    await page.keyboard.type('X');
    await expect(block(page, 'b-1')).toHaveText('Xlo');
    await page.keyboard.press(LINE_START);
    await page.keyboard.press('Backspace');
    await expect(block(page, 'b-0')).toHaveText('helXlo');
    await expect(block(page, 'b-1')).toHaveCount(0);
    await expect(block(page, 'b-0')).toBeFocused();
});

test('arrows walk across a code block and Mod-Enter leaves it', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    const textarea = page.locator('#editor [data-part="code-body"]');
    await expect(textarea).toBeFocused();
    await page.keyboard.type('let x = 1');
    await expect(serialized(page)).toContainText('```\nlet x = 1\n```');
    await page.keyboard.press('ArrowUp');
    await expect(block(page, 'b-0')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(textarea).toBeFocused();
    await page.keyboard.press('Control+Enter');
    await expect(block(page, 'b-2')).toBeFocused();
    await page.keyboard.type('after');
    await expect(serialized(page)).toContainText('```\n\nafter');
});

test('undo reverts typing and the surface shows the previous content', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.type('!!!');
    await expect(p).toHaveText('hello!!!');
    await page.keyboard.press('Control+z');
    await expect(p).toHaveText('hello');
    await expect(serialized(page)).toHaveText('hello');
    await page.keyboard.press('Control+Shift+z');
    await expect(p).toHaveText('hello!!!');
});

test('the toolbar toggles marks on the selection', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(SELECT_ALL);
    const bold = page.locator('#editor [data-scope="richtext-toolbar"] [data-item="bold"]');
    await expect(bold).toHaveAttribute('data-state', 'off');
    await bold.click();
    await expect(p.locator('strong')).toHaveText('hello');
    await expect(bold).toHaveAttribute('data-state', 'on');
    await expect(serialized(page)).toHaveText('**hello**');
    // Focus stayed in the surface: keep typing (at the end of a mark the browser extends it).
    await page.keyboard.press(LINE_END);
    await page.keyboard.type('!');
    await expect(serialized(page)).toHaveText('**hello!**');
});

test('Escape selects the block, Shift-Down extends, Backspace deletes the selection', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('three');
    await block(page, 'b-0').click();
    await expect(block(page, 'b-0')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveAttribute('data-mode', 'block');
    await expect(editor(page)).toBeFocused();
    await expect(page.locator('#editor [data-part="block"][data-selected]')).toHaveCount(1);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('#editor [data-part="block"][data-selected]')).toHaveCount(2);
    await page.keyboard.press('Backspace');
    await expect(serialized(page)).toHaveText('three');
});

test('the block menu turns a paragraph into a heading', async ({ page }) => {
    const wrapper = page.locator('#editor [data-part="block"][data-key="b-0"]');
    await wrapper.hover();
    await wrapper.locator('> [data-part="handle"]').click();
    const menu = page.locator('[data-scope="richtext-block-menu"][role="menu"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-action="turn:heading"]').click();
    await expect(menu).toHaveCount(0);
    await expect(block(page, 'b-0')).toHaveJSProperty('tagName', 'H1');
    await expect(serialized(page)).toHaveText('# hello');
});

test('slash commands insert a divider below the paragraph', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.type(' /div');
    const popup = page.locator('[data-scope="richtext-suggest"][role="listbox"]');
    await expect(popup.locator('[role="option"]')).toHaveText(['Divider']);
    await page.keyboard.press('Enter');
    await expect(popup).toHaveCount(0);
    await expect(page.locator('#editor [data-part="void"][data-type="thematicBreak"]')).toHaveCount(1);
    await expect(serialized(page)).toHaveText('hello\n\n---');
});

test('mentions: @ opens the people list and a pick inserts a chip', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.type(' @be');
    const popup = page.locator('[data-scope="richtext-suggest"][role="listbox"]');
    await expect(popup.locator('[role="option"]')).toHaveText(['Bea']);
    await page.keyboard.press('Enter');
    await expect(p.locator('[data-atom="mention"]')).toHaveText('@Bea');
    await expect(serialized(page)).toHaveText('hello @[Bea](u2)');
    // The chip is one caret stop: Backspace removes the space then the whole chip.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(p.locator('[data-atom="mention"]')).toHaveCount(0);
    await expect(serialized(page)).toHaveText('hello');
});

test('pasting HTML parses the text/html flavour over text/plain', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'plain text that must not win');
        dt.setData('text/html', '<meta charset="utf-8"><h2>Pasted</h2><ul><li>a</li><li>b</li></ul>');
        document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#editor [data-part="inline"][data-type="heading"]')).toHaveText('Pasted');
    await expect(page.locator('#editor [data-part="list-item"]')).toHaveCount(2);
});

test('pasting markdown inserts blocks', async ({ page }) => {
    const p = block(page, 'b-0');
    await p.click();
    await page.keyboard.press(LINE_END);
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', '\n\n## Pasted\n\n- a\n- b');
        document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#editor [data-part="inline"][data-type="heading"]')).toHaveText('Pasted');
    await expect(page.locator('#editor [data-part="list-item"]')).toHaveCount(2);
});
