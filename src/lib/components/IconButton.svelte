<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import Icon from './Icon.svelte';
	let {
		icon,
		label,
		onclick,
		disabled = false,
		busy = false
	}: {
		icon: ComponentProps<typeof Icon>['name'];
		label: string;
		onclick: () => void | Promise<void>;
		disabled?: boolean;
		busy?: boolean;
	} = $props();
</script>

<Tooltip.Provider delayDuration={200}>
	<Tooltip.Root>
		<Tooltip.Trigger
			class="button secondary icon-button"
			aria-label={label}
			aria-busy={busy}
			{disabled}
			{onclick}><Icon name={icon} size={20} /></Tooltip.Trigger
		>
		<Tooltip.Portal
			><Tooltip.Content role="tooltip" class="icon-tooltip" side="top" sideOffset={8}
				>{label}</Tooltip.Content
			></Tooltip.Portal
		>
	</Tooltip.Root>
</Tooltip.Provider>
