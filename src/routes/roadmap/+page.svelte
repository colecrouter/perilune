<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
</script>

<svelte:head><title>Development · Perilune</title></svelte:head>
<AppShell active=""
	><div class="roadmap">
		<h1>Building Perilune</h1>
		<p class="muted">
			Perilune now supports persistent live printer connectivity and a self-hosted daily-use
			workflow. Physical results and device behavior remain subject to attended acceptance. Open
			Help for current setup and use instructions.
		</p>
		<p><a href="/help">Help & setup →</a></p>
		<section id="jobs">
			<h2>Jobs</h2>
			<p>
				Jobs supports inspected uploads, observed history, explicit live print controls, and planned
				manual-change previews. Account → Integrations manages scoped slicer keys and browser
				pairing. Live workflows require explicit server options.
			</p>
		</section>
		<section id="calibration">
			<h2>Calibration</h2>
			<p>
				The simulator Z-offset workshop now includes prerequisites, separate adjustment and
				cancellation controls, and contextual documentation. Bed mesh inspection now visualizes
				reported samples and compatible profile differences. Opt-in cold live probing now supports
				result review, temporary use/restoration and saving with restart verification. Filament
				handling, measured extrusion, and live Z calibration have separately enabled workflows.
				Broader print-based tuning remains future work.
			</p>
		</section>
		<section id="configuration">
			<h2>Configuration</h2>
			<p>
				The configuration workspace now has explained settings, lossless raw editing, protected
				calibration-generated values, reviewed simulator saves, conflict checks and backups. Live
				files support owner-only inspection, drafts, reviewed application, and persistent recovery
				with explicit server opt-in.
			</p>
		</section>
		<section>
			<h2>Camera and authentication</h2>
			<p>
				The go2rtc camera gateway now provides stable app URLs and encoded video playback. Built-in
				accounts, invitations, passkeys, browser pairing, installation, and configurable device
				notifications are implemented. Broader media protocols and external identity integration
				remain future work.
			</p>
		</section>
		<a class="button primary" href="https://github.com/colecrouter/perilune/milestones"
			>Follow development on GitHub</a
		>
	</div></AppShell
>
