import { Schema } from 'effect';
export const overviewPanels = ['camera', 'temperature', 'history', 'connection'] as const;
export type OverviewPanel = (typeof overviewPanels)[number];
export const panelNames: Record<OverviewPanel, string> = {
	camera: 'Camera',
	temperature: 'Temperature controls & sensors',
	history: 'Temperature history',
	connection: 'Connection details'
};
export const OverviewLayout = Schema.Struct({
	preset: Schema.Literals(['balanced', 'camera', 'compact']),
	order: Schema.Array(Schema.Literals(overviewPanels)).check(Schema.isMaxLength(4)),
	hidden: Schema.Array(Schema.Literals(overviewPanels)).check(Schema.isMaxLength(4))
});
export type OverviewLayout = typeof OverviewLayout.Type;
export function overviewPreset(preset: OverviewLayout['preset']): OverviewLayout {
	return {
		preset,
		order: [...overviewPanels],
		hidden: preset === 'compact' ? ['camera', 'history'] : []
	};
}
const decode = Schema.decodeUnknownSync(OverviewLayout, { onExcessProperty: 'error' });
export function checkedOverviewLayout(value: unknown): OverviewLayout {
	const layout = decode(value);
	if (
		layout.order.length !== 4 ||
		new Set(layout.order).size !== 4 ||
		new Set(layout.hidden).size !== layout.hidden.length
	)
		throw Error('Choose each Overview panel once.');
	return layout;
}
export function overviewLayout(value: unknown): OverviewLayout {
	try {
		return checkedOverviewLayout(value);
	} catch {
		return overviewPreset('balanced');
	}
}
