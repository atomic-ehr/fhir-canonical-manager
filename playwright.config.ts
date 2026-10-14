import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./test/browser",
    testMatch: "**/*.pw.ts",
    workers: 1,
    timeout: 60_000,
    reporter: "list",
    use: {
        browserName: "chromium",
        headless: true,
        launchOptions: { executablePath: process.env.FCM_BROWSER_EXECUTABLE },
    },
});
