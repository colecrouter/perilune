import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import legacy from 'vite-plugin-sveltekit-legacy';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
	fmt: {
		useTabs: true,
		singleQuote: true,
		trailingComma: 'none',
		ignorePatterns: [
			'**/*.svelte',
			'src/lib/server/reference/Config_Reference.md',
			'src/lib/server/reference/COPYING'
		]
	},
	lint: { options: { typeAware: true, typeCheck: false } },
	plugins: lazyPlugins(() => [
		sveltekit({
			adapter: adapter(),
			experimental: { remoteFunctions: true },
			compilerOptions: { experimental: { async: true } },
			inspector: true
		}),
		legacy({ modernTargets: ['Safari >= 16.4', 'Chrome >= 110', 'Firefox >= 115'] })
	]),
	ssr: { noExternal: ['@tanstack/svelte-table', '@tanstack/svelte-store'] },
	test: {
		maxWorkers: 4,
		expect: { poll: { timeout: 3000 } },
		projects: [
			{
				extends: true,
				test: {
					name: 'domain',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.browser.test.ts']
				}
			},
			{
				extends: true,
				optimizeDeps: { include: ['vite-plus/test/browser', 'vitest-browser-svelte', 'effect'] },
				test: {
					name: 'browser',
					include: ['src/**/*.browser.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
