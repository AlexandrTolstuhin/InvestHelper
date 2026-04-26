<script lang="ts">
	import { lookupSecurity, searchSecurities, type SecuritySearchHit } from '$lib/api/moex';
	import { upsertHolding } from '$lib/stores/holdings.svelte';

	let { portfolioId, onAdded } = $props<{
		portfolioId: string;
		onAdded?: () => void;
	}>();

	let queryText = $state('');
	let suggestions = $state<SecuritySearchHit[]>([]);
	let searching = $state(false);
	let pickedTicker = $state<string | null>(null);
	let quantity = $state<number>(0);
	let targetPercent = $state<number>(0);
	let submitting = $state(false);
	let error = $state<string | null>(null);

	let searchSeq = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_MS = 300;

	function onQueryInput() {
		pickedTicker = null;
		if (debounceTimer) clearTimeout(debounceTimer);
		const text = queryText.trim();
		if (text.length < 2) {
			suggestions = [];
			searching = false;
			return;
		}
		searching = true;
		debounceTimer = setTimeout(() => runSearch(text), DEBOUNCE_MS);
	}

	async function runSearch(text: string) {
		const seq = ++searchSeq;
		try {
			const hits = await searchSecurities(text);
			if (seq === searchSeq) suggestions = hits;
		} catch {
			if (seq === searchSeq) suggestions = [];
		} finally {
			if (seq === searchSeq) searching = false;
		}
	}

	function pick(hit: SecuritySearchHit) {
		queryText = `${hit.ticker} — ${hit.shortName}`;
		pickedTicker = hit.ticker;
		suggestions = [];
	}

	async function submit(e: Event) {
		e.preventDefault();
		error = null;
		const ticker = pickedTicker;
		if (!ticker) {
			error = 'Выберите бумагу из списка';
			return;
		}
		if (!Number.isFinite(quantity) || quantity < 0) {
			error = 'Количество должно быть неотрицательным';
			return;
		}
		if (!Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100) {
			error = 'Целевой процент в диапазоне 0..100';
			return;
		}
		submitting = true;
		try {
			const ref = await lookupSecurity(ticker);
			await upsertHolding(portfolioId, {
				ticker: ref.ticker,
				board: ref.board,
				quantity,
				lotsize: 1, // обновится после первой подгрузки котировок
				targetPercent,
				shortName: ref.shortName
			});
			queryText = '';
			pickedTicker = null;
			quantity = 0;
			targetPercent = 0;
			onAdded?.();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			submitting = false;
		}
	}
</script>

<form class="card preset-tonal space-y-3 p-4" onsubmit={submit}>
	<h3 class="h5">Добавить бумагу</h3>

	<div class="relative">
		<input
			class="input"
			type="text"
			placeholder="Тикер или название (напр. TGLD, Сбер)"
			bind:value={queryText}
			oninput={onQueryInput}
			autocomplete="off"
		/>
		{#if suggestions.length > 0}
			<ul class="card preset-filled-surface-100-900 absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-y-auto p-1 shadow-xl">
				{#each suggestions as hit (hit.ticker)}
					<li>
						<button
							type="button"
							class="hover:bg-primary-500/10 w-full rounded px-2 py-1 text-left"
							onclick={() => pick(hit)}
						>
							<span class="font-mono">{hit.ticker}</span>
							<span class="opacity-70"> — {hit.shortName}</span>
							{#if hit.type}<span class="ml-2 text-xs opacity-50">{hit.type}</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else if searching}
			<div class="absolute left-2 top-full mt-1 text-xs opacity-50">ищу…</div>
		{/if}
	</div>

	<div class="grid grid-cols-2 gap-3">
		<label class="label">
			<span class="text-xs opacity-70">Сейчас на руках, шт.</span>
			<input class="input" type="number" min="0" step="1" bind:value={quantity} />
		</label>
		<label class="label">
			<span class="text-xs opacity-70">Целевая доля, %</span>
			<input
				class="input"
				type="number"
				min="0"
				max="100"
				step="0.01"
				bind:value={targetPercent}
			/>
		</label>
	</div>

	{#if error}
		<p class="text-error-500 text-sm">{error}</p>
	{/if}

	<button
		class="btn preset-filled-primary-500 w-full"
		type="submit"
		disabled={submitting || !pickedTicker}
	>
		{submitting ? 'Сохраняю…' : 'Добавить'}
	</button>
</form>
