<script lang="ts">
	import { asset } from '$app/paths';
	import { moonPhasePath } from '#lib/domain/moon.js';
	let { dot = true, class: className = '' }: { dot?: boolean; class?: string } = $props();
	const id = $props.id();
</script>

<svg class={className} viewBox="0 0 100 100" aria-hidden="true">
	<defs><clipPath {id}><path d={moonPhasePath(0.23)} /></clipPath></defs>
	<image
		href={asset('brand/moon-texture.png')}
		width="100"
		height="100"
		clip-path={`url(#${id})`}
	/>
	{#if dot}<circle cx="27" cy="30" r="5" fill="#c9c3ec" />{/if}
</svg>
