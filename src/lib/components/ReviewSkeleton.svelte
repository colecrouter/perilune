<script lang="ts">
	let { label = 'Loading pending settings' }: { label?: string } = $props();
</script>

<div class="review-skeleton" role="status" aria-label={label} aria-busy="true">
	<div class="skeleton-button"></div>
	<div class="skeleton-line"></div>
	<div class="skeleton-row"></div>
	<div class="skeleton-row"></div>
	<div class="skeleton-line"></div>
	<div class="skeleton-button"></div>
</div>

<style>
	.review-skeleton {
		display: grid;
		gap: 1rem;
		padding-block: 0.5rem;
	}
	.review-skeleton > div {
		background: var(--border);
		border-radius: 0.35rem;
	}
	.skeleton-button {
		height: 2.75rem;
		width: min(100%, 15rem);
	}
	.skeleton-line {
		height: 1.25rem;
		width: 85%;
	}
	.skeleton-row {
		height: 2.5rem;
	}
</style>
