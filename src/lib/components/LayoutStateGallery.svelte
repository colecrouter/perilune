<script lang="ts">
	import ReviewSkeleton from './ReviewSkeleton.svelte';
	import HeaterControl from './HeaterControl.svelte';
	import FeedbackRegion from './FeedbackRegion.svelte';
	import WorkflowNotice from './WorkflowNotice.svelte';
	const states = ['Ready', 'Loading', 'Pending', 'Success', 'Error', 'Reconnect'] as const;
	let fixtureState = $state<(typeof states)[number]>('Ready');
	let target = $state(0);
	async function setTarget(value: number) {
		fixtureState = 'Pending';
		await new Promise((resolve) => setTimeout(resolve, 400));
		target = value;
		fixtureState = 'Success';
	}
</script>

<main class="gallery">
	<h1>Layout state gallery</h1>
	<p>
		Development-only synthetic fixtures. No printer commands or configuration requests are sent.
	</p>
	<nav aria-label="Fixture state">
		{#each states as value}<button
				class="button secondary"
				aria-pressed={fixtureState === value}
				onclick={() => (fixtureState = value)}>{value}</button
			>{/each}
	</nav>
	<section class="fixture notice-fixture" aria-label="Persistent notice fixture">
		<WorkflowNotice kind={fixtureState === 'Error' ? 'attention' : 'progress'}>
			{#snippet title()}{fixtureState === 'Error'
					? 'Operation needs review'
					: 'Calibration workflow'}{/snippet}
			{#snippet children()}<p>
					{fixtureState === 'Error'
						? 'An uncertain outcome needs explicit review. Nothing will be replayed automatically. '.repeat(
								12
							)
						: fixtureState === 'Reconnect'
							? 'Connection interrupted. Retained state is shown; wait for fresh telemetry.'
							: 'The backend owns the workflow. Your controls and drafts stay in place.'}
				</p>{/snippet}
			{#snippet actions()}<a href="#feedback-fixture">Review fixture</a>{/snippet}
		</WorkflowNotice>
	</section>
	<section class="panel fixture heater-fixture" aria-label="Heater fixture">
		<h2>Heater control</h2>
		<HeaterControl
			heater="nozzle"
			current={['Reconnect', 'Loading'].includes(fixtureState) ? null : 23}
			{target}
			pending={['Pending', 'Loading'].includes(fixtureState)}
			available={fixtureState !== 'Reconnect'}
			onSet={setTarget}
		/>
	</section>
	<section
		id="feedback-fixture"
		class="panel fixture feedback-fixture"
		aria-label="Feedback fixture"
	>
		<h2>Reserved feedback</h2>
		<FeedbackRegion
			active={['Success', 'Error', 'Reconnect'].includes(fixtureState)}
			label="Fixture feedback"
		>
			{#if fixtureState === 'Success'}<p role="status">
					Fixture saved.
				</p>{:else if fixtureState === 'Error'}<p role="alert">
					{'The draft is retained. Review the failure before another operation. '.repeat(12)}
				</p>{:else if fixtureState === 'Reconnect'}<p role="status">
					The draft below is retained.
				</p>{/if}
		</FeedbackRegion>
		<label
			>Retained draft<input
				aria-label="Retained fixture draft"
				value="Do not replace my draft"
			/></label
		>
		<button class="button primary fixture-submit" disabled={fixtureState === 'Pending'}
			>Save fixture</button
		>
	</section>
	<section class="panel fixture" aria-label="Review loading fixture">
		<h2>Review loading</h2>
		<div class="review-frame">
			{#if fixtureState === 'Loading'}<ReviewSkeleton label="Loading fixture review" />{:else}<p>
					Example values and reviewed action. Loading reserves this same space.
				</p>{/if}
		</div>
		<button
			class="button primary review-submit"
			disabled={['Loading', 'Pending'].includes(fixtureState)}>Apply fixture</button
		>
	</section>
</main>

<style>
	.gallery {
		max-width: 60rem;
		margin-inline: auto;
		padding: 1rem;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-block: 1rem;
	}
	.fixture {
		margin-block: 1rem;
	}
	.panel {
		padding: 1rem;
	}
	.review-frame {
		block-size: 18rem;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	label {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
</style>
