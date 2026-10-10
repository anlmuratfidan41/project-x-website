import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const publicPages = ['about', 'work', 'careers', 'contact', 'privacy', '404', 'step-2-quote', 'step-5-delivery'];
const adminPages = ['login', 'dashboard', 'requests', 'calendar', 'materials', 'price-list', 'inventory', 'finance', 'health', 'applications'];
const pageEntries = Object.fromEntries([
	...publicPages.map((page) => [`page-${page}`, `pages/${page}.html`]),
	...adminPages.map((page) => [`admin-${page}`, `admin/${page}.html`]),
].map(([name, file]) => [name, resolve(__dirname, file)]));

const isSitePage = (path: string) => path.startsWith('/pages/') || path.startsWith('/admin/');

// Clean URLs in dev, matching the production server: /work → pages/work.html, /admin/login → admin/login.html,
// and old /pages/x.html or /admin/x.html links redirect to the clean address.
const cleanPublic = new Set(publicPages.filter((page) => page !== '404'));
// Removed step pages redirect so old emailed links (?verify=, ?quote=) still land somewhere useful.
const removedPages: Record<string, string> = { 'step-1-request': '/contact', 'step-3-deposit': '/step-2-quote', 'step-4-build': '/' };
function cleanUrlMiddleware(request: { url?: string }, response: { statusCode: number; setHeader(name: string, value: string): void; end(): void }, next: () => void): void {
	const [path, query = ''] = (request.url ?? '/').split('?');
	const search = query ? `?${query}` : '';
	const legacy = /^\/pages\/([\w-]+)\.html$/.exec(path) ?? /^\/admin\/([\w-]+)\.html$/.exec(path);
	const removed = removedPages[legacy && !path.startsWith('/admin/') ? legacy[1] : path.slice(1)];
	if (legacy || removed) {
		response.statusCode = 301;
		response.setHeader('Location', removed
			? `${removed}${search}`
			: path.startsWith('/admin/') ? `/admin/${legacy![1]}${search}` : `${legacy![1] === 'work' ? '/' : `/${legacy![1]}`}${search}`);
		response.end();
		return;
	}
	if (path === '/' || path === '/work') request.url = `/pages/work.html${search}`;
	else if (/^\/[\w-]+$/.test(path) && cleanPublic.has(path.slice(1))) request.url = `/pages${path}.html${search}`;
	else if (/^\/admin\/[\w-]+$/.test(path) && adminPages.includes(path.slice(7))) request.url = `${path}.html${search}`;
	next();
}

export default defineConfig({
	// Multi-page site: unknown addresses get a 404 instead of falling back to the root page.
	appType: 'mpa',
	plugins: [react(), {
		name: 'project-x-clean-urls',
		configureServer(server) {
			server.middlewares.use(cleanUrlMiddleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(cleanUrlMiddleware);
		},
	}, {
		// Runs before Vite processes the HTML so the build bundles the runtime instead of linking the .ts source.
		name: 'project-x-runtime-script',
		transformIndexHtml: {
			order: 'pre',
			handler(html, context) {
				if (!isSitePage(context.path ?? '')) return html;
				return html.replace('</body>', '<script type="module" src="/src/page-runtime.ts"></script></body>');
			},
		},
	}, {
		name: 'project-x-html-pages',
		transformIndexHtml(html, context) {
			const path = context.path ?? '';
			if (!path.startsWith('/pages/') && !path.startsWith('/admin/')) return html;

			let transformed = html
				// Relative "assets/" or "../assets/" only; paths Vite already wrote as "/assets/..." must stay untouched.
				.replace(/(?<![\w/.-])(?:\.\.\/)?assets\//g, '/assets/')
				.replace(/href="admin\//g, 'href="/admin/');

			if (path.startsWith('/pages/contact.html')) {
				transformed = transformed
					.replace('By sending, you agree to receive your confirmation and quote by email and SMS. Message and data rates may apply.', 'We will email you about this request. SMS updates are optional.')
					.replace(/(<button[^>]*>SEND REQUEST<\/button>)/i, '<label data-sms-consent style="grid-column:1/-1;display:flex;gap:10px;align-items:flex-start;color:#9fb0bf;font-size:13px;line-height:20px"><input id="px-sms-consent" type="checkbox" style="width:18px;height:18px;accent-color:#3fb0d8;flex:none"/><span>I agree to receive SMS updates about this request. Message and data rates may apply. Reply STOP to opt out. See our <a href="/privacy" style="color:#3fb0d8">Privacy Policy</a>.</span></label>$1');
			}

			return transformed;
		},
	}, {
		// Pages reference photos as plain /assets/... paths, which Rollup does not bundle,
		// so copy the folder into the build; files Vite already emitted (hashed names) are kept.
		name: 'project-x-copy-assets',
		apply: 'build',
		closeBundle() {
			const source = resolve(__dirname, 'assets');
			if (existsSync(source)) cpSync(source, resolve(__dirname, 'dist/assets'), { recursive: true, force: false });
		},
	}],
	server: {
		// OneDrive briefly locks newly synced files; watching images crashed the dev server with EBUSY.
		watch: { ignored: ['**/*.{jpg,jpeg,png,webp,gif,svg,pdf}'] },
	},
	build: {
		rollupOptions: {
			input: { app: resolve(__dirname, 'index.html'), ...pageEntries },
		},
	},
});
