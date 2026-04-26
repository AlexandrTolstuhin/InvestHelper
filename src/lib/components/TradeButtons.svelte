<script lang="ts">
	import { describeFirestoreError } from '$lib/firebase';
	import { recordBuy, recordSell } from '$lib/stores/transactions.svelte';

	interface Props {
		portfolioId: string;
		ticker: string;
		quantity: number;
		lotsize: number;
	}

	let { portfolioId, ticker, quantity, lotsize }: Props = $props();

	let mode = $state<'idle' | 'buy' | 'sell'>('idle');
	let lots = $state<number>(1);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const maxSellLots = $derived(Math.floor(quantity / Math.max(1, lotsize)));

	function open(next: 'buy' | 'sell') {
		mode = next;
		lots = 1;
		error = null;
	}

	function cancel() {
		mode = 'idle';
		error = null;
	}

	async function submit(e: Event) {
		e.preventDefault();
		if (busy) return;
		const n = Number(lots);
		if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
			error = 'Введите целое положительное число лотов';
			return;
		}
		if (mode === 'sell' && n > maxSellLots) {
			error = `Можно продать не больше ${maxSellLots} лот. (${quantity} шт.)`;
			return;
		}
		busy = true;
		error = null;
		try {
			if (mode === 'buy') {
				await recordBuy(portfolioId, ticker, n);
			} else if (mode === 'sell') {
				await recordSell(portfolioId, ticker, n);
			}
			mode = 'idle';
		} catch (err) {
			error = describeFirestoreError(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if mode === 'idle'}
	<div class="flex flex-wrap gap-1">
		<button
			class="btn btn-sm preset-tonal-primary"
			type="button"
			onclick={() => open('buy')}
			aria-label="Купить {ticker}"
		>
			+ Купить
		</button>
		<button
			class="btn btn-sm preset-tonal"
			type="button"
			onclick={() => open('sell')}
			disabled={maxSellLots <= 0}
			aria-label="Продать {ticker}"
		>
			− Продать
		</button>
	</div>
{:else}
	<form class="flex flex-wrap items-center gap-1" onsubmit={submit}>
		<input
			class="input nums w-20"
			type="number"
			min="1"
			max={mode === 'sell' ? maxSellLots : undefined}
			step="1"
			bind:value={lots}
			aria-label="Лотов"
		/>
		<span class="text-xs opacity-60">лот.</span>
		<button
			class="btn btn-sm {mode === 'buy' ? 'preset-filled-primary-500' : 'preset-filled-error-500'}"
			type="submit"
			disabled={busy}
		>
			{busy ? '...' : mode === 'buy' ? 'Купить' : 'Продать'}
		</button>
		<button class="btn btn-sm preset-tonal" type="button" onclick={cancel} disabled={busy}>
			✕
		</button>
		{#if error}
			<div class="text-error-500 basis-full text-xs">{error}</div>
		{/if}
	</form>
{/if}
