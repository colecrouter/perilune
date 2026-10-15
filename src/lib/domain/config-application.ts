export type ApplicationPhase = 'queued' | 'writing' | 'restarting' | 'ready' | 'error' | 'unknown';
export interface ConfigApplication {
	id: string;
	path: string;
	mode: 'apply' | 'revert';
	phase: ApplicationPhase;
	message: string;
	diagnostic: string | null;
	createdAt: number;
	updatedAt: number;
	writeVerified: boolean;
	revertOf: string | null;
}
export interface ConfigRecovery {
	enabled: boolean;
	application: ConfigApplication | null;
}
export interface ApplyConfiguration {
	id: string;
	path: string;
	expectedVersion: string;
	text: string;
	confirmedRestart: true;
}
