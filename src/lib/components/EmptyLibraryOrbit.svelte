<script lang="ts">
	const maskId = $props.id();
</script>

<svg viewBox="0 0 100 70" width="100" height="70" aria-hidden="true" class="empty-library-orbit">
	<defs
		><mask id={maskId}
			><rect width="100" height="70" fill="white" /><circle
				cx="52"
				cy="33"
				r="22"
				fill="black"
			/></mask
		></defs
	>
	<ellipse
		cx="50"
		cy="36"
		rx="43"
		ry="20"
		fill="none"
		stroke="var(--muted)"
		stroke-width="1"
		stroke-dasharray="2 5"
		mask={`url(#${maskId})`}
	/>
	<path d="M52 11a22 22 0 0 1 0 44c16-13 16-31 0-44" fill="var(--highlight-text)" />
	<circle cx="15" cy="26" r="3" fill="var(--accent)" />
</svg>

<style>
	.empty-library-orbit {
		display: block;
		margin: 0 auto 0.75rem;
	}
	@media (prefers-color-scheme: dark) {
		path {
			fill: var(--highlight);
		}
	}
</style>
