/** Session-local serialized editor states: no DOM nodes, callbacks, credentials or persistence. */
export class EditorSessions {
	private states = new Map<string, string>();
	private versions = new Map<string, number>();
	private size = 0;
	constructor(
		private maxBytes = 8 * 1024 * 1024,
		private maxFiles = 32
	) {}
	version(path: string) {
		return this.versions.get(path) ?? 0;
	}
	get(path: string) {
		const value = this.states.get(path);
		return value ? JSON.parse(value) : null;
	}
	clear(path: string) {
		const previous = this.states.get(path);
		if (previous) this.size -= previous.length * 2;
		this.states.delete(path);
		this.versions.set(path, this.version(path) + 1);
	}
	put(path: string, version: number, value: unknown) {
		if (version !== this.version(path)) return true;
		const serialized = JSON.stringify(value),
			previous = this.states.get(path);
		const size = this.size - (previous?.length ?? 0) * 2 + serialized.length * 2;
		if (size > this.maxBytes || (!previous && this.states.size >= this.maxFiles)) {
			this.clear(path);
			return false;
		}
		this.states.set(path, serialized);
		this.size = size;
		return true;
	}
}
