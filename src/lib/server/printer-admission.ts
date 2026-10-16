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

interface SafetyInterlock {
	epoch: number;
	halted: boolean;
	interrupt: () => number;
	clear: (expectedEpoch: number) => boolean;
	allows: (epoch: number) => boolean;
}
const interlocks = new WeakMap<object, SafetyInterlock>();
/** Synchronous checks also fence writes whose ordinary admission already completed. */
export function printerInterlock(state: object): SafetyInterlock {
	let lock = interlocks.get(state);
	if (!lock) {
		lock = {
			epoch: 0,
			halted: false,
			interrupt() {
				this.halted = true;
				return ++this.epoch;
			},
			clear(expectedEpoch) {
				if (this.epoch !== expectedEpoch) return false;
				this.halted = false;
				this.epoch++;
				return true;
			},
			allows(epoch) {
				return !this.halted && this.epoch === epoch;
			}
		};
		interlocks.set(state, lock);
	}
	return lock;
}
