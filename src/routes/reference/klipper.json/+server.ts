import { json } from '@sveltejs/kit';
import { buildReference } from '#lib/server/reference/catalogue.js';
export const prerender = true;
let catalogue: ReturnType<typeof buildReference> | undefined;
export async function GET() {
	catalogue ??= buildReference();
	return json(await catalogue, {
		headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' }
	});
}
