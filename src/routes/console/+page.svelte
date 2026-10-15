<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	import ConsoleWorkspace from '#lib/components/ConsoleWorkspace.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Macros & console · Perilune</title></svelte:head>
<AppShell active="Console"
	><div class="page serif">
		<header>
			<p class="eyebrow">A direct line to the printer</p>
			<h1>Macros & console</h1>
			<p>Understand a command. Review it. Follow the response.</p>
		</header>
		{#if ['owner', 'operator'].includes(data.user?.role ?? '')}<ConsoleWorkspace />{:else}<section
				class="panel"
			>
				<h2>Operator access required</h2>
				<p>
					Command history and macro responses can contain private information. An operator or owner
					account is required.
				</p>
			</section>{/if}
	</div></AppShell
>

<style>
	.page {
		padding: clamp(1rem, 3vw, 2.5rem);
		max-width: 1500px;
		margin: auto;
	}
	header {
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: clamp(2.2rem, 5vw, 3rem);
		margin: 0.4rem 0;
	}
	header > p:last-child {
		color: var(--muted);
	}
	.panel {
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
</style>
