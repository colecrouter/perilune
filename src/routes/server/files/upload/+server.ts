import type { RequestEvent } from '@sveltejs/kit';
import { jobUpload } from '#lib/server/job-http.js';
export const POST = (event: RequestEvent) => jobUpload(event, true);
