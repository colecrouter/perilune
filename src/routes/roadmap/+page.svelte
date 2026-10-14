<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
</script>

<svelte:head><title>Development · Perilune</title></svelte:head>
<AppShell active=""
	><div class="roadmap">
		<h1>Building Perilune</h1>
		<p class="muted">
			This first slice proves shared state, service lifetimes, and responsive controls. The
			following workflows are being developed in focused increments.
		</p>
		<section id="jobs">
			<h2>Jobs</h2>
			<p>
				The Jobs library now supports G-code uploads, observed print history, and scoped slicer
				upload keys. Live file writes and print scheduling remain planned.
			</p>
		</section>
		<section id="calibration">
			<h2>Calibration</h2>
			<p>
				The simulator Z-offset workshop now includes prerequisites, separate adjustment and
				cancellation controls, and contextual documentation. Bed mesh inspection now visualizes
				reported samples and compatible profile differences. Live probing, filament handling,
				extrusion calibration, and first-layer test prints remain planned.
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
				The go2rtc camera gateway now provides stable app URLs and encoded video playback. Built-in
				accounts, invitations and passkeys are implemented. Broader media protocols, external
				authentication, and print notifications remain planned.
			</p>
		</section>
		<a class="button primary" href="https://github.com/colecrouter/perilune/milestones"
			>Follow development on GitHub</a
		>
	</div></AppShell
>
