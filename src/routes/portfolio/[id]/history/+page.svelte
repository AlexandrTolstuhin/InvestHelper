<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import HoldingsHistoryChart from '$lib/components/HoldingsHistoryChart.svelte';
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

	const periods: { value: Period; label: string }[] = [
		{ value: 'month', label: 'Месяц' },
		{ value: 'year', label: 'Год' },
		{ value: 'all', label: 'Всё время' }
	];

	let period = $state<Period>('all');
	let excludedTickers = $state(new Set<string>());

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

			<HoldingsHistoryChart transactions={filtered} />

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
								<th>Штук</th>
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
									<td class:text-error-500={t.qty < 0}>
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
