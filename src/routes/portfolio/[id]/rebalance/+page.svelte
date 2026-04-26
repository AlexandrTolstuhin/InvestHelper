<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import { authState } from '$lib/stores/auth.svelte';
	import {
		getHoldingsState,
		unwatchHoldings,
		watchHoldings
	} from '$lib/stores/holdings.svelte';
	import { fetchQuotes, type PriceQuote } from '$lib/api/moex';
	import { buyOnlyStrategy } from '$lib/rebalance';
	import { formatNumber, formatPercent, formatRub } from '$lib/utils/format';

	const portfolioId = $derived(page.params.id ?? '');
	const holdings = $derived(getHoldingsState(portfolioId));

	let quotes = $state<Map<string, PriceQuote>>(new Map());
	let quotesLoading = $state(false);
	let quotesError = $state<string | null>(null);
	let deposit = $state<number>(50000);

	$effect(() => {
		if (authState.status === 'authorized' && portfolioId) {
			watchHoldings(portfolioId);
		}
	});

	let lastQuotedKey = '';
	$effect(() => {
		const key = holdings.items
			.map((h) => `${h.ticker}|${h.board}`)
			.sort()
			.join(',');
		if (key && key !== lastQuotedKey) {
			lastQuotedKey = key;
			untrack(() => loadQuotes());
		}
	});

	onDestroy(() => unwatchHoldings(portfolioId));

	async function loadQuotes() {
		if (holdings.items.length === 0) {
			quotes = new Map();
			return;
		}
		quotesLoading = true;
		quotesError = null;
		try {
			const refs = holdings.items.map((h) => ({
				ticker: h.ticker,
				shortName: h.shortName,
				engine: 'stock',
				market: inferMarket(h.board),
				board: h.board
			}));
			quotes = await fetchQuotes(refs);
		} catch (err) {
			quotesError = (err as Error).message;
		} finally {
			quotesLoading = false;
		}
	}

	function inferMarket(board: string): string {
		if (board.startsWith('TQO') || board.startsWith('TQC') || board.startsWith('TQI'))
			return 'bonds';
		return 'shares';
	}

	const result = $derived.by(() => {
		const list = holdings.items
			.map((h) => {
				const q = quotes.get(h.ticker);
				return {
					ticker: h.ticker,
					shortName: h.shortName,
					price: q?.price ?? 0,
					lotsize: q?.lotsize ?? h.lotsize ?? 1,
					quantity: h.quantity,
					targetPercent: h.targetPercent
				};
			});
		return buyOnlyStrategy.compute({
			holdings: list,
			deposit: Number.isFinite(deposit) ? deposit : 0
		});
	});

	const itemsToShow = $derived(result.items.filter((i) => i.lotsToBuy > 0 || i.targetPercent > 0));
</script>

<AuthGuard>
	<section class="space-y-6">
		<a class="anchor text-sm" href="{base}/portfolio/{portfolioId}">← К портфелю</a>
		<h1 class="h2">Ребалансировка</h1>

		{#if holdings.loading || quotesLoading}
			<p class="opacity-70">Загружаем данные…</p>
		{:else if holdings.error}
			<p class="text-error-500">{holdings.error}</p>
		{:else if holdings.items.length === 0}
			<div class="card preset-tonal p-6 text-center opacity-70">
				В портфеле нет бумаг. Добавьте их на странице портфеля.
			</div>
		{:else}
			<div class="grid gap-4 md:grid-cols-[260px_1fr] md:items-start">
				<div class="card preset-tonal space-y-3 p-4">
					<label class="label">
						<span class="text-xs opacity-70">Сумма к внесению, ₽</span>
						<input
							class="input"
							type="number"
							min="0"
							step="100"
							bind:value={deposit}
						/>
					</label>
					<dl class="space-y-1 text-sm">
						<div class="flex justify-between">
							<dt class="opacity-70">Сейчас в портфеле</dt>
							<dd>{formatRub(result.totalCurrentValue)}</dd>
						</div>
						<div class="flex justify-between">
							<dt class="opacity-70">Будет потрачено</dt>
							<dd>{formatRub(result.totalSpent)}</dd>
						</div>
						<div class="flex justify-between">
							<dt class="opacity-70">Остаток кэша</dt>
							<dd>{formatRub(result.leftover)}</dd>
						</div>
						<div class="flex justify-between border-t pt-1 font-semibold">
							<dt>После покупки</dt>
							<dd>{formatRub(result.totalNewValue)}</dd>
						</div>
					</dl>
				</div>

				<div class="overflow-x-auto">
					<table class="table w-full text-sm">
						<thead>
							<tr>
								<th>Тикер</th>
								<th>Цена</th>
								<th>Лот</th>
								<th>Купить</th>
								<th>Стоимость</th>
								<th>Цель / новая</th>
							</tr>
						</thead>
						<tbody>
							{#each itemsToShow as item (item.ticker)}
								<tr class:opacity-50={item.lotsToBuy === 0}>
									<td>
										<div class="font-mono">{item.ticker}</div>
										<div class="text-xs opacity-60">{item.shortName}</div>
									</td>
									<td>
										{#if item.price > 0}
											{formatRub(item.price)}
										{:else}
											<span class="text-error-500 text-xs">нет цены</span>
										{/if}
									</td>
									<td>{item.lotsize}</td>
									<td>
										{#if item.lotsToBuy > 0}
											<div class="font-semibold">{item.lotsToBuy} лот.</div>
											<div class="text-xs opacity-60">= {formatNumber(item.qtyToBuy)} шт.</div>
										{:else}
											<span class="opacity-50">—</span>
										{/if}
									</td>
									<td>{formatRub(item.spend)}</td>
									<td>
										<div>{formatPercent(item.targetPercent)}</div>
										<div class="text-xs opacity-60">→ {formatPercent(item.newPercent)}</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>

					{#if result.warnings.length > 0}
						<aside class="card preset-tonal-warning mt-4 space-y-1 p-3 text-sm">
							{#each result.warnings as w (w)}
								<div>• {w}</div>
							{/each}
						</aside>
					{/if}
					{#if quotesError}
						<p class="text-error-500 mt-2 text-sm">Котировки: {quotesError}</p>
					{/if}
				</div>
			</div>
		{/if}
	</section>
</AuthGuard>
