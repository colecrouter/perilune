import { Schema } from 'effect';
/** Retain the application payload bounds in addition to the wire bound in the hook. */
export const remoteRecord = (limit: number) =>
	Schema.toStandardSchemaV1(
		Schema.Record(Schema.String, Schema.Unknown).check(
			Schema.makeFilter((value) => {
				try {
					return (
						Buffer.byteLength(JSON.stringify(value), 'utf8') <= limit || 'Request is too large.'
					);
				} catch {
					return 'Invalid request.';
				}
			})
		)
	);
