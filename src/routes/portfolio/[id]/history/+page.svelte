<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import HoldingsHistoryChart from '$lib/components/HoldingsHistoryChart.svelte';
	import { fetchQuotes, type PriceQuote } from '$lib/api/moex';
	import { authState } from '$lib/stores/auth.svelte';
	import {
		getHoldingsState,
		unwatchHoldings,
		watchHoldings
	} from '$lib/stores/holdings.svelte';
	import {
		getTransactionsState,
		unwatchTransactions,
		watchTransactions,
		type Transaction
	} from '$lib/stores/transactions.svelte';
	import { formatNumber } from '$lib/utils/format';

	const portfolioId = $derived(page.params.id ?? '');
	const holdings = $derived(getHoldingsState(portfolioId));
	const transactions = $derived(getTransactionsState(portfolioId));

	$effect(() => {
		if (authState.status === 'authorized' && portfolioId) {
			watchHoldings(portfolioId);
			watchTransactions(portfolioId);
		}
	});

	onDestroy(() => {
		unwatchHoldings(portfolioId);
		unwatchTransactions(portfolioId);
	});

	type Period = 'month' | 'year' | 'all';
	type Mode = 'lots' | 'value';

	const periods: { value: Period; label: string }[] = [
		{ value: 'month', label: 'Месяц' },
		{ value: 'year', label: 'Год' },
		{ value: 'all', label: 'Всё время' }
	];

	const modes: { value: Mode; label: string }[] = [
		{ value: 'lots', label: 'Лоты' },
		{ value: 'value', label: 'Стоимость, ₽' }
	];

	const PERIOD_VALUES: Period[] = ['month', 'year', 'all'];
	const MODE_VALUES: Mode[] = ['lots', 'value'];
	const FILTERS_STORAGE_PREFIX = 'investhelper-history-filters-';

	type SavedFilters = { period: Period; mode: Mode; excludedTickers: string[] };

	function loadFilters(id: string): Partial<SavedFilters> | null {
		if (typeof window === 'undefined') return null;
		try {
			const raw = localStorage.getItem(FILTERS_STORAGE_PREFIX + id);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Partial<SavedFilters>;
			const result: Partial<SavedFilters> = {};
			if (parsed.period && PERIOD_VALUES.includes(parsed.period)) {
				result.period = parsed.period;
			}
			if (parsed.mode && MODE_VALUES.includes(parsed.mode)) {
				result.mode = parsed.mode;
			}
			if (Array.isArray(parsed.excludedTickers)) {
				result.excludedTickers = parsed.excludedTickers.filter(
					(t): t is string => typeof t === 'string'
				);
			}
			return result;
		} catch {
			return null;
		}
	}

	function saveFilters(id: string, data: SavedFilters): void {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(FILTERS_STORAGE_PREFIX + id, JSON.stringify(data));
		} catch {
			// localStorage может быть недоступен (приватный режим) — фильтры останутся в памяти страницы.
		}
	}

	let period = $state<Period>('all');
	let mode = $state<Mode>('lots');
	let excludedTickers = $state(new Set<string>());

	$effect(() => {
		const id = portfolioId;
		if (!id) return;
		const saved = loadFilters(id);
		period = saved?.period ?? 'all';
		mode = saved?.mode ?? 'lots';
		excludedTickers = new Set(saved?.excludedTickers ?? []);
	});

	$effect(() => {
		const id = portfolioId;
		if (!id) return;
		saveFilters(id, {
			period,
			mode,
			excludedTickers: Array.from(excludedTickers)
		});
	});

	let quotes = $state<Map<string, PriceQuote>>(new Map());
	let quotesLoading = $state(false);
	let quotesError = $state<string | null>(null);
	let lastQuotedKey = '';

	function inferMarket(board: string): string {
		if (board.startsWith('TQO') || board.startsWith('TQC') || board.startsWith('TQI'))
			return 'bonds';
		return 'shares';
	}

	$effect(() => {
		if (mode !== 'value') return;
		if (holdings.loading || holdings.items.length === 0) return;
		const key = holdings.items
			.map((h) => `${h.ticker}|${h.board}`)
			.sort()
			.join(',');
		if (key === lastQuotedKey) return;
		lastQuotedKey = key;
		untrack(() => loadQuotes());
	});

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

	const priceMap = $derived.by(() => {
		const m = new Map<string, number>();
		for (const [ticker, q] of quotes) m.set(ticker, q.price);
		return m;
	});

	const allTickers = $derived(
		Array.from(new Set(transactions.items.map((t) => t.ticker))).sort()
	);

	const periodCutoff = $derived.by(() => {
		if (period === 'all') return null;
		const days = period === 'month' ? 30 : 365;
		return Date.now() - days * 86_400_000;
	});

	const filtered = $derived(
		transactions.items.filter((t) => {
			if (excludedTickers.has(t.ticker)) return false;
			if (periodCutoff !== null) {
				if (!t.date || t.date.getTime() < periodCutoff) return false;
			}
			return true;
		})
	);

	const reverseSorted = $derived(
		filtered.slice().sort((a, b) => {
			const ta = a.date?.getTime() ?? 0;
			const tb = b.date?.getTime() ?? 0;
			return tb - ta;
		})
	);

	function toggleTicker(ticker: string): void {
		const next = new Set(excludedTickers);
		if (next.has(ticker)) next.delete(ticker);
		else next.add(ticker);
		excludedTickers = next;
	}

	function resetTickers(): void {
		excludedTickers = new Set();
	}

	const dateFmt = new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	function kindLabel(t: Transaction): string {
		switch (t.kind) {
			case 'initial':
				return 'Начало';
			case 'buy':
				return 'Покупка';
			case 'sell':
				return 'Продажа';
		}
	}

	function kindClass(kind: Transaction['kind']): string {
		switch (kind) {
			case 'buy':
				return 'preset-tonal-primary';
			case 'sell':
				return 'preset-tonal-error';
			case 'initial':
				return 'preset-tonal';
		}
	}
</script>

<AuthGuard>
	<section class="space-y-6">
		<a class="anchor text-sm" href={resolve('/portfolio/[id]', { id: portfolioId })}
			>← К портфелю</a
		>
		<h1 class="h2">История операций</h1>

		{#if transactions.loading || holdings.loading}
			<p class="opacity-70">Загружаем…</p>
		{:else if transactions.error}
			<p class="text-error-500">{transactions.error}</p>
		{:else}
			<div class="card preset-tonal space-y-3 p-4">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs opacity-70">Период</span>
					{#each periods as p (p.value)}
						<button
							type="button"
							class="btn btn-sm {period === p.value
								? 'preset-filled-primary-500'
								: 'preset-tonal'}"
							onclick={() => (period = p.value)}>{p.label}</button
						>
					{/each}
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs opacity-70">Ось Y</span>
					{#each modes as m (m.value)}
						<button
							type="button"
							class="btn btn-sm {mode === m.value
								? 'preset-filled-primary-500'
								: 'preset-tonal'}"
							onclick={() => (mode = m.value)}>{m.label}</button
						>
					{/each}
				</div>

				{#if allTickers.length > 1}
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs opacity-70">Тикеры</span>
						{#each allTickers as t (t)}
							<button
								type="button"
								class="btn btn-sm font-mono {excludedTickers.has(t)
									? 'preset-tonal opacity-50'
									: 'preset-filled-primary-500'}"
								onclick={() => toggleTicker(t)}>{t}</button
							>
						{/each}
						{#if excludedTickers.size > 0}
							<button
								type="button"
								class="btn btn-sm preset-tonal"
								onclick={resetTickers}>Сбросить</button
							>
						{/if}
					</div>
				{/if}
			</div>

			{#if mode === 'value' && quotesError}
				<p class="text-error-500 text-sm">Не удалось загрузить цены: {quotesError}</p>
			{:else if mode === 'value' && quotesLoading && priceMap.size === 0}
				<p class="text-sm opacity-70">Загружаем цены…</p>
			{:else}
				<HoldingsHistoryChart transactions={filtered} {mode} prices={priceMap} />
			{/if}

			{#if transactions.items.length === 0}
				<div class="card preset-tonal p-6 text-center opacity-70">
					Операций ещё не было. Добавьте бумагу или совершите покупку.
				</div>
			{:else if reverseSorted.length === 0}
				<div class="card preset-tonal p-6 text-center opacity-70">
					Под выбранные фильтры ничего не попало.
				</div>
			{:else}
				<div class="card border-surface-200-800 overflow-x-auto border p-2">
					<table class="nums table w-full text-sm">
						<thead>
							<tr>
								<th>Дата</th>
								<th>Тикер</th>
								<th>Тип</th>
								<th>Лотов</th>
								<th class="hidden sm:table-cell">Штук</th>
							</tr>
						</thead>
						<tbody>
							{#each reverseSorted as t (t.id)}
								<tr>
									<td>{t.date ? dateFmt.format(t.date) : '—'}</td>
									<td class="font-mono">{t.ticker}</td>
									<td>
										<span class="badge {kindClass(t.kind)}">{kindLabel(t)}</span>
									</td>
									<td class:text-error-500={t.kind === 'sell'}>
										{t.kind === 'sell' ? '−' : ''}{formatNumber(t.lots)}
									</td>
									<td class="hidden sm:table-cell" class:text-error-500={t.qty < 0}>
										{formatNumber(Math.abs(t.qty))}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</section>
</AuthGuard>
