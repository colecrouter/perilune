<script lang="ts">
	import SettingSwitch from './SettingSwitch.svelte';
	import { preferencesContext } from '#lib/client/preferences.svelte.js';
	const preferences = preferencesContext();
</script>

{#if preferences}
	<section class="account-card display-preferences" aria-label="Display preferences">
		<h2>Make yourself at home</h2>
		<p>
			Display choices are saved to your account and used on your other devices when you open
			Perilune. Notification permissions remain specific to each device.
		</p>
		<label
			><SettingSwitch
				checked={preferences.values.serif}
				onchange={(event) => preferences.update({ serif: event.currentTarget.checked })}
			/>Serif headings</label
		>
		<label
			>Default files per page<select
				value={preferences.values.jobsPageSize}
				onchange={(event) =>
					preferences.update({ jobsPageSize: Number(event.currentTarget.value) as 10 | 25 | 50 })}
				><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option
				></select
			></label
		>
		<label
			>Temperature history window<select
				value={preferences.values.temperatureMinutes}
				onchange={(event) =>
					preferences.update({
						temperatureMinutes: Number(event.currentTarget.value) as 5 | 15 | 60
					})}
				><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option
					value={60}>1 hour</option
				></select
			></label
		>
		<p class="muted" role={preferences.saving || preferences.error ? 'status' : undefined}>
			{preferences.saving
				? 'Saving preferences…'
				: preferences.error
					? 'Not saved yet. Your choices remain in this tab.'
					: 'Console display and file columns are also remembered when you change them.'}
		</p>
	</section>
{/if}

<style>
	.account-card {
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 0.8rem;
		background: var(--surface);
	}
	h2 {
		margin-top: 0;
	}
	p {
		line-height: 1.5;
	}
	label {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 1rem 0;
	}
	select {
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
