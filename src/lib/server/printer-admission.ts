import { Semaphore } from 'effect';

// A weak key ties admission to the process-owned printer instance, including in tests/HMR.
// Hold only through durable admission, never while executing a physical operation.
const gates = new WeakMap<object, Semaphore.Semaphore>();
export function printerAdmission(state: object): Semaphore.Semaphore {
	let gate = gates.get(state);
	if (!gate) {
		gate = Semaphore.makeUnsafe(1);
		gates.set(state, gate);
	}
	return gate;
}
