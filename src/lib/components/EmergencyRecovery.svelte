<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import EmergencyRecoverySteps from './EmergencyRecoverySteps.svelte';
	let { snapshot }: { snapshot: PrinterSnapshot } = $props();
</script>

{#key snapshot.safety?.recovery?.token}
	<EmergencyRecoverySteps {snapshot} />
{/key}
