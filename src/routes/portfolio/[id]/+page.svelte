<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import AddHoldingForm from '$lib/components/AddHoldingForm.svelte';
	import { authState } from '$lib/stores/auth.svelte';
	import {
		getHoldingsState,
		patchHolding,
		removeHolding,
		unwatchHoldings,
		watchHoldings
	} from '$lib/stores/holdings.svelte';
	import { fetchQuotes, type PriceQuote } from '$lib/api/moex';
	import { formatNumber, formatPercent, formatRub } from '$lib/utils/format';

	const portfolioId = $derived(page.params.id ?? '');
	const holdings = $derived(getHoldingsState(portfolioId));

	let quotes = $state<Map<string, PriceQuote>>(new Map());
	let quotesLoading = $state(false);
	let quotesError = $state<string | null>(null);
	let lastQuotesAt = $state<number | null>(null);

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
			lastQuotesAt = Date.now();
			// Подтягиваем lotsize и shortName в Firestore, если у нас они дефолтные.
			for (const h of holdings.items) {
				const q = quotes.get(h.ticker);
				if (!q) continue;
				if (q.lotsize !== h.lotsize || q.shortName !== h.shortName) {
					patchHolding(portfolioId, h.ticker, { lotsize: q.lotsize }).catch(() => {});
				}
			}
		} catch (err) {
			quotesError = (err as Error).message;
		} finally {
			quotesLoading = false;
		}
	}

	function inferMarket(board: string): string {
		// Эвристика по префиксу доски: TQOB/TQCB/TQIR — облигации, TQTF — фонды,
		// TQBR/TQTD/TQLI — акции. Для незнакомых досок по умолчанию shares.
		if (board.startsWith('TQO') || board.startsWith('TQC') || board.startsWith('TQI'))
			return 'bonds';
		return 'shares';
	}

	const enriched = $derived(
		holdings.items.map((h) => {
			const q = quotes.get(h.ticker);
			const price = q?.price ?? 0;
			const value = price * h.quantity;
			return { ...h, price, value, quote: q };
		})
	);

	const totalValue = $derived(enriched.reduce((s, h) => s + h.value, 0));
	const totalTarget = $derived(holdings.items.reduce((s, h) => s + h.targetPercent, 0));

	async function onQtyChange(ticker: string, raw: string) {
		const v = Number(raw);
		if (!Number.isFinite(v) || v < 0) return;
		try {
			await patchHolding(portfolioId, ticker, { quantity: v });
		} catch (e) {
			alert((e as Error).message);
		}
	}

	async function onTargetChange(ticker: string, raw: string) {
		const v = Number(raw);
		if (!Number.isFinite(v) || v < 0 || v > 100) return;
		try {
			await patchHolding(portfolioId, ticker, { targetPercent: v });
		} catch (e) {
			alert((e as Error).message);
		}
	}

	async function onRemove(ticker: string) {
		if (!confirm(`Удалить ${ticker} из портфеля?`)) return;
		try {
			await removeHolding(portfolioId, ticker);
		} catch (e) {
			alert((e as Error).message);
		}
	}
</script>

<AuthGuard>
	<section class="space-y-6">
		<a class="anchor text-sm" href={resolve('/')}>← Все портфели</a>
		<header class="card preset-tonal flex flex-wrap items-end justify-between gap-3 p-4">
			<div>
				<h1 class="h2">Портфель</h1>
				<p class="text-sm opacity-60">ID: <code>{portfolioId}</code></p>
			</div>
			<div class="nums text-right text-sm">
				<div>Стоимость: <strong>{formatRub(totalValue)}</strong></div>
				<div class="opacity-70">
					Сумма целей:
					<span class:text-error-500={Math.abs(totalTarget - 100) > 0.01}>
						{formatNumber(totalTarget)}%
					</span>
				</div>
				{#if lastQuotesAt}
					<div class="text-xs opacity-50">
						Цены обновлены {new Date(lastQuotesAt).toLocaleTimeString('ru-RU')}
					</div>
				{/if}
			</div>
		</header>

		{#if Math.abs(totalTarget - 100) > 0.01 && holdings.items.length > 0}
			<aside class="card preset-tonal-warning p-3 text-sm">
				Сумма целевых долей должна быть 100%. Сейчас {formatNumber(totalTarget)}% —
				ребалансировка может работать неожиданно.
			</aside>
		{/if}

		{#if holdings.loading}
			<p class="opacity-70">Загружаем холдинги…</p>
		{:else if holdings.error}
			<p class="text-error-500">{holdings.error}</p>
		{:else}
			<div class="grid gap-6 md:grid-cols-[1fr_320px]">
				<div>
					{#if holdings.items.length === 0}
						<div class="card preset-tonal p-6 text-center opacity-70">
							Пока нет бумаг. Добавьте первую справа.
						</div>
					{:else}
						<div class="card border-surface-200-800 overflow-x-auto border p-2">
						<table class="nums table w-full text-sm">
							<thead>
								<tr>
									<th>Тикер</th>
									<th>Цена</th>
									<th>Лот</th>
									<th>Кол-во</th>
									<th>Стоимость</th>
									<th>Сейчас, %</th>
									<th>Цель, %</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each enriched as h (h.ticker)}
									<tr>
										<td>
											<div class="font-mono">{h.ticker}</div>
											<div class="text-xs opacity-60">{h.shortName}</div>
										</td>
										<td>
											{#if h.price > 0}
												{formatRub(h.price)}
												{#if h.quote && h.quote.source !== 'LAST'}
													<div class="text-xs opacity-50">{h.quote.source}</div>
												{/if}
											{:else if quotesLoading}
												<span class="opacity-50">…</span>
											{:else}
												<span class="text-error-500 text-xs">нет цены</span>
											{/if}
										</td>
										<td>{h.lotsize}</td>
										<td>
											<input
												class="input w-24"
												type="number"
												min="0"
												step={h.lotsize}
												value={h.quantity}
												onchange={(e) =>
													onQtyChange(h.ticker, (e.target as HTMLInputElement).value)}
											/>
										</td>
										<td>{formatRub(h.value)}</td>
										<td>
											{totalValue > 0 ? formatPercent((h.value / totalValue) * 100) : '—'}
										</td>
										<td>
											<input
												class="input w-20"
												type="number"
												min="0"
												max="100"
												step="0.01"
												value={h.targetPercent}
												onchange={(e) =>
													onTargetChange(h.ticker, (e.target as HTMLInputElement).value)}
											/>
										</td>
										<td>
											<button
												class="btn btn-sm preset-tonal-error"
												type="button"
												onclick={() => onRemove(h.ticker)}>×</button
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
						</div>
					{/if}
					{#if quotesError}
						<p class="text-error-500 mt-2 text-sm">Котировки: {quotesError}</p>
					{/if}
					{#if holdings.items.length > 0}
						<div class="mt-4 text-right">
							<a
								class="btn preset-filled-primary-500"
								href={resolve('/portfolio/[id]/rebalance', { id: portfolioId })}
							>
								Перейти к ребалансировке →
							</a>
						</div>
					{/if}
				</div>

				<aside class="md:sticky md:top-20 md:self-start">
					<AddHoldingForm {portfolioId} />
				</aside>
			</div>
		{/if}
	</section>
</AuthGuard>
