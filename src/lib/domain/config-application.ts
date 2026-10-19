export type ApplicationPhase = 'queued' | 'writing' | 'restarting' | 'ready' | 'error' | 'unknown';
export interface ConfigApplication {
	id: string;
	path: string;
	mode: 'apply' | 'revert' | 'calibration' | 'discard';
	phase: ApplicationPhase;
	message: string;
	diagnostic: string | null;
	createdAt: number;
	updatedAt: number;
	writeVerified: boolean;
	revertOf: string | null;
	calibrationRun?: string;
}
export interface ConfigRecovery {
	enabled: boolean;
	discardEnabled?: boolean;
	application: ConfigApplication | null;
}
export interface ApplyConfiguration {
	id: string;
	path: string;
	expectedVersion: string;
	text: string;
	sources?: { root: string; fingerprint: string };
	confirmedRestart: true;
}

export interface PendingConfigurationReview {
	path: string;
	manifest: Record<string, Record<string, string>>;
	fingerprint: string;
	sources: { root: string; fingerprint: string };
}
export interface SavePendingConfiguration {
	discard?: true;
	id: string;
	pending: string;
	sources: { root: string; fingerprint: string };
	confirmedRestart: true;
}
