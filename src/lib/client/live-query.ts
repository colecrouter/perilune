/**
 * Read live queries through transient framework proxies rather than retaining one
 * in component context. Kit 3's shared resource retains its creation context;
 * storing that first proxy there forms a cycle that defeats its GC-based release.
 * Promise getter reads still pin the resource to the consuming Svelte effect, and
 * the framework's key-based cache continues to share the actual stream.
 */
export function liveQuery<T extends object>(create: () => T): T {
	return new Proxy({} as T, {
		get(_target, key) {
			const query = create();
			const value = Reflect.get(query, key, query);
			return typeof value === 'function' ? value.bind(query) : value;
		}
	});
}
