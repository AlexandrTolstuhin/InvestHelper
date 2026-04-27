<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import { describeFirestoreError } from '$lib/firebase';
	import { authState } from '$lib/stores/auth.svelte';
	import {
		getHoldingsState,
		holdingDisplayName,
		unwatchHoldings,
		watchHoldings
	} from '$lib/stores/holdings.svelte';
	import { applyRebalance } from '$lib/stores/transactions.svelte';
	import { fetchQuotes, type PriceQuote } from '$lib/api/moex';
	import { buyOnlyStrategy } from '$lib/rebalance';
	import { formatNumber, formatPercent, formatRub } from '$lib/utils/format';

	const portfolioId = $derived(page.params.id ?? '');
	const holdings = $derived(getHoldingsState(portfolioId));

	let quotes = $state<Map<string, PriceQuote>>(new Map());
	let quotesLoading = $state(false);
	let quotesError = $state<string | null>(null);
	let deposit = $state<number>(50000);

	// Пользовательские правки рекомендаций по тикеру.
	// undefined → используем рекомендацию из расчёта.
	let edits = $state<Record<string, number | undefined>>({});
	let applying = $state(false);
	let applyError = $state<string | null>(null);
	let applyMessage = $state<string | null>(null);

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
		const list = holdings.items.map((h) => {
			const q = quotes.get(h.ticker);
			return {
				ticker: h.ticker,
				shortName: h.shortName,
				displayName: holdingDisplayName(h),
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

	const itemsToShow = $derived(
		result.items.filter((i) => i.lotsToBuy > 0 || i.targetPercent > 0 || i.currentQty > 0)
	);

	function effectiveLots(ticker: string, recommended: number): number {
		const v = edits[ticker];
		return v === undefined ? recommended : v;
	}

	function maxSellLots(ticker: string): number {
		const item = result.items.find((i) => i.ticker === ticker);
		if (!item) return 0;
		const lotsize = Math.max(1, item.lotsize || 1);
		return Math.floor(item.currentQty / lotsize);
	}

	function clampSell(ticker: string, raw: number): number {
		if (!Number.isFinite(raw)) return 0;
		const n = Math.trunc(raw);
		if (n >= 0) return n;
		const minAllowed = -maxSellLots(ticker);
		return n < minAllowed ? minAllowed : n;
	}

	function onLotsInput(ticker: string, raw: string) {
		const n = Number(raw);
		const clamped = clampSell(ticker, n);
		edits[ticker] = clamped;
		applyMessage = null;
		applyError = null;
	}

	function resetEdits() {
		edits = {};
		applyError = null;
		applyMessage = null;
	}

	const summary = $derived.by(() => {
		let buyValue = 0;
		let sellValue = 0;
		let buyCount = 0;
		let sellCount = 0;
		for (const item of result.items) {
			const lots = effectiveLots(item.ticker, item.lotsToBuy);
			if (lots > 0) {
				buyValue += lots * item.lotsize * item.price;
				buyCount += 1;
			} else if (lots < 0) {
				sellValue += -lots * item.lotsize * item.price;
				sellCount += 1;
			}
		}
		return { buyValue, sellValue, buyCount, sellCount };
	});

	async function onApply() {
		if (applying) return;
		applyError = null;
		applyMessage = null;
		const ops: { ticker: string; lots: number }[] = [];
		for (const item of result.items) {
			const lots = effectiveLots(item.ticker, item.lotsToBuy);
			if (!Number.isFinite(lots) || lots === 0) continue;
			if (lots < 0) {
				const max = maxSellLots(item.ticker);
				if (-lots > max) {
					applyError = `${item.ticker}: можно продать не более ${max} лот.`;
					return;
				}
			}
			ops.push({ ticker: item.ticker, lots });
		}
		if (ops.length === 0) {
			applyError = 'Нет ненулевых операций для применения';
			return;
		}
		const lines = ['Применить операции?'];
		if (summary.buyCount > 0) {
			lines.push(`Покупка: ${summary.buyCount} позиц. на ${formatRub(summary.buyValue)}`);
		}
		if (summary.sellCount > 0) {
			lines.push(`Продажа: ${summary.sellCount} позиц. на ${formatRub(summary.sellValue)}`);
		}
		if (!confirm(lines.join('\n'))) return;
		applying = true;
		try {
			await applyRebalance(portfolioId, ops);
			edits = {};
			applyMessage = `Применено операций: ${ops.length}`;
		} catch (err) {
			applyError = describeFirestoreError(err);
		} finally {
			applying = false;
		}
	}
</script>

<AuthGuard>
	<section class="space-y-6">
		<a class="anchor text-sm" href={resolve('/portfolio/[id]', { id: portfolioId })}
			>← К портфелю</a
		>
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
						<input class="input" type="number" min="0" step="100" bind:value={deposit} />
					</label>
					<dl class="nums space-y-1 text-sm">
						<div class="flex justify-between">
							<dt class="opacity-70">Сейчас в портфеле</dt>
							<dd>{formatRub(result.totalCurrentValue)}</dd>
						</div>
						<div class="flex justify-between">
							<dt class="opacity-70">Будет потрачено</dt>
							<dd>{formatRub(summary.buyValue)}</dd>
						</div>
						{#if summary.sellValue > 0}
							<div class="flex justify-between">
								<dt class="opacity-70">Получено от продаж</dt>
								<dd>{formatRub(summary.sellValue)}</dd>
							</div>
						{/if}
						<div class="flex justify-between">
							<dt class="opacity-70">Остаток кэша</dt>
							<dd>{formatRub(deposit - summary.buyValue + summary.sellValue)}</dd>
						</div>
					</dl>
					<button
						class="btn preset-filled-primary-500 w-full"
						type="button"
						onclick={onApply}
						disabled={applying || (summary.buyCount === 0 && summary.sellCount === 0)}
					>
						{applying ? 'Применяю…' : 'Применить как операции'}
					</button>
					<button
						class="btn preset-tonal w-full"
						type="button"
						onclick={resetEdits}
						disabled={applying || Object.keys(edits).length === 0}
					>
						Сбросить правки
					</button>
					{#if applyError}
						<p class="text-error-500 text-xs">{applyError}</p>
					{/if}
					{#if applyMessage}
						<p class="text-success-600-400 text-xs">{applyMessage}</p>
					{/if}
				</div>

				<div>
					<div class="card border-surface-200-800 hidden overflow-x-auto border p-2 sm:block">
						<table class="nums table w-full text-sm">
							<thead>
								<tr>
									<th>Тикер</th>
									<th>Цена</th>
									<th>Лот</th>
									<th>Сейчас</th>
									<th>Лотов (−прод./+пок.)</th>
									<th>Стоимость</th>
									<th>Цель / новая</th>
								</tr>
							</thead>
							<tbody>
								{#each itemsToShow as item (item.ticker)}
									{@const lots = effectiveLots(item.ticker, item.lotsToBuy)}
									{@const spend = lots * item.lotsize * item.price}
									{@const newQty = item.currentQty + lots * item.lotsize}
									<tr class:opacity-50={lots === 0 && item.targetPercent === 0}>
										<td>
											<div class="font-mono">{item.ticker}</div>
											<div class="text-xs opacity-60">{item.displayName}</div>
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
											<div>{formatNumber(item.currentQty)}</div>
											<div class="text-xs opacity-50">
												{Math.floor(item.currentQty / Math.max(1, item.lotsize))} лот.
											</div>
										</td>
										<td>
											<input
												class="input nums w-24"
												type="number"
												step="1"
												min={-maxSellLots(item.ticker)}
												value={lots}
												aria-label="Лотов для {item.ticker} (отрицательно — продажа)"
												oninput={(e) =>
													onLotsInput(
														item.ticker,
														(e.target as HTMLInputElement).value
													)}
											/>
											{#if lots !== 0}
												<div
													class="text-xs"
													class:text-error-500={lots < 0}
													class:opacity-60={lots > 0}
												>
													{lots > 0 ? 'купить' : 'продать'} {Math.abs(lots) * item.lotsize} шт.
												</div>
											{/if}
										</td>
										<td class:text-error-500={spend < 0}>
											{formatRub(spend)}
										</td>
										<td>
											<div>{formatPercent(item.targetPercent)}</div>
											<div class="text-xs opacity-60">
												→ {formatNumber(newQty)} шт.
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<ul class="space-y-3 sm:hidden">
						{#each itemsToShow as item (item.ticker)}
							{@const lots = effectiveLots(item.ticker, item.lotsToBuy)}
							{@const spend = lots * item.lotsize * item.price}
							{@const newQty = item.currentQty + lots * item.lotsize}
							<li
								class="card border-surface-200-800 space-y-3 border p-3"
								class:opacity-50={lots === 0 && item.targetPercent === 0}
							>
								<div class="flex items-start justify-between gap-2">
									<div>
										<div class="font-mono text-base">{item.ticker}</div>
										<div class="text-xs opacity-60">{item.displayName}</div>
									</div>
									<div class="nums text-right text-sm">
										{#if item.price > 0}
											<div>{formatRub(item.price)}</div>
										{:else}
											<div class="text-error-500 text-xs">нет цены</div>
										{/if}
										<div class="text-xs opacity-50">лот: {item.lotsize}</div>
									</div>
								</div>

								<dl class="nums grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
									<dt class="opacity-60">Сейчас</dt>
									<dd class="text-right">
										{formatNumber(item.currentQty)} шт.
										<span class="text-xs opacity-50">
											({Math.floor(item.currentQty / Math.max(1, item.lotsize))} лот.)
										</span>
									</dd>

									<dt class="opacity-60">Цель</dt>
									<dd class="text-right">
										{formatPercent(item.targetPercent)}
										<span class="text-xs opacity-60">→ {formatNumber(newQty)} шт.</span>
									</dd>

									<dt class="opacity-60">Стоимость</dt>
									<dd class="text-right" class:text-error-500={spend < 0}>{formatRub(spend)}</dd>
								</dl>

								<label class="space-y-1">
									<span class="text-xs opacity-70">Лотов (− продажа / + покупка)</span>
									<input
										class="input nums w-full"
										type="number"
										step="1"
										min={-maxSellLots(item.ticker)}
										value={lots}
										aria-label="Лотов для {item.ticker} (отрицательно — продажа)"
										oninput={(e) =>
											onLotsInput(item.ticker, (e.target as HTMLInputElement).value)}
									/>
									{#if lots !== 0}
										<div
											class="text-xs"
											class:text-error-500={lots < 0}
											class:opacity-60={lots > 0}
										>
											{lots > 0 ? 'купить' : 'продать'} {Math.abs(lots) * item.lotsize} шт.
										</div>
									{/if}
								</label>
							</li>
						{/each}
					</ul>

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
