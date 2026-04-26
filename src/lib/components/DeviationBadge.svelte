<script lang="ts">
	import { formatNumber } from '$lib/utils/format';

	interface Props {
		deviation: number | null;
	}

	let { deviation }: Props = $props();

	const tier = $derived.by(() => {
		if (deviation === null || !Number.isFinite(deviation)) return null;
		const abs = Math.abs(deviation);
		if (abs >= 10) return 'error';
		if (abs >= 5) return 'warning';
		return null;
	});
</script>

{#if tier && deviation !== null}
	<span
		class="badge nums shrink-0 text-xs"
		class:preset-tonal-warning={tier === 'warning'}
		class:preset-tonal-error={tier === 'error'}
		title="Максимальное отклонение факта от цели по бумаге в портфеле"
	>
		±{formatNumber(Math.abs(deviation))} п.п.
	</span>
{/if}
