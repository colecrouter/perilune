import { buildInfo } from '#lib/server/build-info.js';
import { json } from '@sveltejs/kit';
import { Effect, SubscriptionRef } from 'effect';
import { PrinterService } from '#lib/server/printer-service.js';
import { runtime } from '#lib/server/runtime.js';

export async function GET() {
	const state = await runtime.runPromise(
		Effect.flatMap(PrinterService, (service) => SubscriptionRef.get(service.state))
	);
	return json(
		{ status: state ? 'ok' : 'starting', ...buildInfo },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
}
