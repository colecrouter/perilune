import {
	reviewPendingConfiguration,
	getConfigurationRecovery
} from '../../routes/configuration/configuration.remote.js';
/** A new explicit review must observe current calibration settings, including after closing a prior review. */
export function refreshPendingSettings() {
	void reviewPendingConfiguration()
		.refresh()
		.catch(() => {});
	void getConfigurationRecovery()
		.refresh()
		.catch(() => {});
}
