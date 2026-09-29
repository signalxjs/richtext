/**
 * Playwright config for the showcase e2e suite.
 *
 * Serves the BUILT app (`vite preview`), so build first — locally
 * `pnpm build && pnpm --filter editor-example build`, in CI the `e2e` job
 * does exactly that before `pnpm --filter editor-example e2e`. The editor
 * core's cross-engine paths are covered by the Lab's suite; this one checks
 * the zero skin on Chromium.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'pnpm preview',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000
    }
});
