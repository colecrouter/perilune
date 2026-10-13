<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
</script>

<svelte:head><title>Development · Perilune</title></svelte:head>
<AppShell active=""
	><div class="roadmap">
		<h1>Building Perilune</h1>
		<p class="muted">
			This first slice proves shared state, service lifetimes, and responsive controls. The
			following workflows are planned, not yet implemented.
		</p>
		<section id="jobs">
			<h2>Jobs</h2>
			<p>
				Upload and manage G-code, track print history, and connect OrcaSlicer through a compatible
				API.
			</p>
		</section>
		<section id="calibration">
			<h2>Calibration</h2>
			<p>
				Guided Z calibration, understandable prerequisites, separated movement and cancellation
				controls, and contextual documentation.
			</p>
		</section>
		<section id="configuration">
			<h2>Configuration</h2>
			<p>
				Explore an explained printer configuration editor that preserves comments, includes, macros,
				and calibration-generated values.
			</p>
		</section>
		<section>
			<h2>Camera and authentication</h2>
			<p>
				Stable camera URLs and intelligent media processing, followed by built-in accounts and
				external authentication support.
			</p>
		</section>
		<a class="button primary" href="https://github.com/colecrouter/perilune/milestones"
			>Follow development on GitHub</a
		>
	</div></AppShell
>
