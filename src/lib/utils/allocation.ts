import type { Holding } from '$lib/stores/holdings.svelte';
import type { PriceQuote } from '$lib/api/moex';

export interface AllocationRow {
	ticker: string;
	shortName: string;
	value: number;
	actualPercent: number;
	targetPercent: number;
	deviation: number;
}

export interface AllocationResult {
	rows: AllocationRow[];
	totalValue: number;
}

export function computeAllocations(
	holdings: Holding[],
	quotes: Map<string, PriceQuote>
): AllocationResult {
	const valued = holdings.map((h) => {
		const q = quotes.get(h.ticker);
		const price = q?.price ?? 0;
		return { holding: h, value: price * h.quantity };
	});
	const totalValue = valued.reduce((s, v) => s + v.value, 0);
	const rows: AllocationRow[] = valued.map(({ holding, value }) => {
		const actualPercent = totalValue > 0 ? (value / totalValue) * 100 : 0;
		return {
			ticker: holding.ticker,
			shortName: holding.shortName,
			value,
			actualPercent,
			targetPercent: holding.targetPercent,
			deviation: actualPercent - holding.targetPercent
		};
	});
	return { rows, totalValue };
}

export function maxAbsDeviation(rows: AllocationRow[]): number {
	let max = 0;
	for (const r of rows) {
		const abs = Math.abs(r.deviation);
		if (abs > max) max = abs;
	}
	return max;
}
