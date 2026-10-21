import { prerender } from '$app/server';
import { buildReference } from '#lib/server/reference/catalogue.js';
export const getKlipperReference = prerender(() => buildReference());
