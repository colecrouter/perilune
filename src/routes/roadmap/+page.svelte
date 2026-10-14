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
				The simulator Z-offset workshop now includes prerequisites, separate adjustment and
				cancellation controls, and contextual documentation. Live probing and first-layer test
				prints remain planned.
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
				The go2rtc camera gateway now provides stable app URLs and encoded video playback. Broader
				media protocols, built-in accounts, and external authentication support follow.
			</p>
		</section>
		<a class="button primary" href="https://github.com/colecrouter/perilune/milestones"
			>Follow development on GitHub</a
		>
	</div></AppShell
>
