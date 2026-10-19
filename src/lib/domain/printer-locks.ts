import { filamentChangeActive, filamentChangeLockMessage } from './filament-change.js';
import type { PrinterSnapshot } from './printer.js';
import { meshProbeActive } from './mesh-probe.js';
import { extrusionActive } from './extrusion.js';
import { calibrationActive } from './calibration.js';
import { liveZActive } from './live-z.js';
import { pidActive } from './pid.js';

/** Explanations only. Admission and recovery remain owned by their existing services. */
export interface PrinterLockNotice {
	id:
		| 'filamentChange'
		| 'mesh'
		| 'extrusion'
		| 'pid'
		| 'z'
		| 'calibration'
		| 'configuration'
		| 'storage';
	kind: 'progress' | 'attention';
	title: string;
	message: string;
	href: string;
	label: string;
	ownerRequired?: boolean;
	operatorRequired?: boolean;
}
export function printerLockNotices(state: PrinterSnapshot): PrinterLockNotice[] {
	const notices: PrinterLockNotice[] = [];
	if (filamentChangeActive(state.filamentChange))
		notices.push({
			id: 'filamentChange',
			kind: state.filamentChange?.stage === 'review' ? 'attention' : 'progress',
			title:
				state.filamentChange?.stage === 'review'
					? 'Filament change needs review'
					: 'Filament change in progress',
			message: filamentChangeLockMessage,
			href: '/filament',
			label: 'Review filament change',
			operatorRequired: true
		});
	const mesh = state.meshProbe.session;
	if (meshProbeActive(state.meshProbe)) {
		const uncertain = mesh?.stage === 'uncertain';
		notices.push({
			id: 'mesh',
			kind: uncertain ? 'attention' : 'progress',
			title: uncertain
				? 'Bed-mesh recovery needs attention'
				: mesh?.stage === 'review'
					? 'Bed-mesh review is waiting'
					: 'Bed-mesh calibration in progress',
			message: uncertain
				? 'Controls are paused because the previous bed-mesh operation could not be verified. Check the printer and review the bed-mesh workflow.'
				: 'The bed-mesh workflow owns the printer. Finish or cancel it there before using other controls.',
			href: '/calibration/mesh',
			label: 'Review bed mesh'
		});
	}
	if (extrusionActive(state.extrusion))
		notices.push({
			id: 'extrusion',
			kind: 'progress',
			title: 'Extrusion calibration in progress',
			message:
				'The extrusion workflow owns the printer. Finish or cancel it there before using other controls.',
			href: '/calibration/extrusion',
			label: 'Review extrusion calibration'
		});
	if (pidActive(state.pid))
		notices.push({
			id: 'pid',
			kind: 'progress',
			title: 'Heater calibration in progress',
			message:
				'Heater calibration owns the printer. Follow its progress or use its stop control before starting other operations.',
			href: '/calibration/pid',
			label: 'Review heater calibration'
		});
	if (liveZActive(state.liveZ) || state.zProbe?.active)
		notices.push({
			id: 'z',
			kind: 'progress',
			title: 'Z calibration in progress',
			message:
				'A manual probe owns the printer. Finish or abort it through Z calibration before using other controls.',
			href: '/calibration',
			label: 'Review Z calibration'
		});
	if (calibrationActive(state.calibration))
		notices.push({
			id: 'calibration',
			kind: 'progress',
			title: 'Calibration workshop in progress',
			message:
				'The calibration workshop owns the printer. Finish or cancel the workflow before using other controls.',
			href: '/calibration',
			label: 'Review calibration'
		});
	if (state.motion.calibration && !notices.length)
		notices.push({
			id: 'calibration',
			kind: 'attention',
			title: 'Printer calibration needs review',
			message:
				'The printer reports an active calibration. Review its state before using other controls; no operation will be cleared automatically.',
			href: '/calibration',
			label: 'Review calibration'
		});
	if (state.configurationBusy)
		notices.push({
			id: 'configuration',
			kind: 'progress',
			title: 'Configuration workflow holds controls',
			message:
				'A configuration workflow owns the printer. An owner can review its progress and recovery status.',
			href: '/configuration#configuration-recovery',
			label: 'Review configuration',
			ownerRequired: true
		});
	if (state.storage !== 'healthy')
		notices.push({
			id: 'storage',
			operatorRequired: true,
			kind: 'attention',
			title: 'Action storage needs attention',
			message:
				'Action storage is unavailable or recovering. Review action outcomes before submitting more commands.',
			href: '/activity',
			label: 'Review activity'
		});
	return notices.sort((a, b) => Number(b.kind === 'attention') - Number(a.kind === 'attention'));
}

export function canReviewPrinterLock(notice: PrinterLockNotice, role?: string): boolean {
	return notice.ownerRequired
		? role === 'owner'
		: notice.operatorRequired
			? role === 'owner' || role === 'operator'
			: true;
}
