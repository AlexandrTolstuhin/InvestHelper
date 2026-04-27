import { collection, getDocs } from 'firebase/firestore';
import { SvelteMap } from 'svelte/reactivity';
import { getDb } from '$lib/firebase';
import { authState } from '$lib/stores/auth.svelte';
import { fetchQuotes, type PriceQuote, type SecurityRef } from '$lib/api/moex';
import { computeAllocations, maxAbsDeviation } from '$lib/utils/allocation';
import type { Holding } from '$lib/stores/holdings.svelte';
import type { Portfolio } from '$lib/stores/portfolios.svelte';

export interface PortfolioSummary {
	maxDeviation: number;
	totalValue: number;
	computedAt: number;
}

interface SummariesState {
	map: SvelteMap<string, PortfolioSummary | null>;
	loading: boolean;
}

export const summariesState: SummariesState = $state({
	map: new SvelteMap<string, PortfolioSummary | null>(),
	loading: false
});

let inflight: Promise<void> | null = null;
let lastSig = '';

function inferMarket(board: string): string {
	if (board.startsWith('TQO') || board.startsWith('TQC') || board.startsWith('TQI')) {
		return 'bonds';
	}
	return 'shares';
}

export function watchSummaries(portfolios: Portfolio[]) {
	const sig = portfolios.map((p) => p.id).sort().join(',');
	if (sig === lastSig) return;
	lastSig = sig;
	void recompute(portfolios);
}

async function recompute(portfolios: Portfolio[]) {
	if (inflight) return;
	const uid = authState.user?.uid;
	if (!uid || authState.status !== 'authorized') return;

	summariesState.loading = true;
	inflight = (async () => {
		try {
			const holdingsByPortfolio = new Map<string, Holding[]>();
			await Promise.all(
				portfolios.map(async (p) => {
					try {
						const snap = await getDocs(
							collection(getDb(), 'users', uid, 'portfolios', p.id, 'holdings')
						);
						const items: Holding[] = snap.docs.map((d) => {
							const data = d.data();
							const ts = data.createdAt as { toDate(): Date } | undefined;
							return {
								id: d.id,
								ticker: String(data.ticker ?? d.id),
								board: String(data.board ?? ''),
								quantity: Number(data.quantity ?? 0),
								lotsize: Number(data.lotsize ?? 1),
								targetPercent: Number(data.targetPercent ?? 0),
								shortName: String(data.shortName ?? d.id),
								customName:
									typeof data.customName === 'string' && data.customName.trim()
										? String(data.customName)
										: null,
								createdAt: ts ? ts.toDate() : null
							};
						});
						holdingsByPortfolio.set(p.id, items);
					} catch {
						holdingsByPortfolio.set(p.id, []);
					}
				})
			);

			const refMap = new Map<string, SecurityRef>();
			for (const items of holdingsByPortfolio.values()) {
				for (const h of items) {
					if (!h.board) continue;
					if (!refMap.has(h.ticker)) {
						refMap.set(h.ticker, {
							ticker: h.ticker,
							shortName: h.shortName,
							engine: 'stock',
							market: inferMarket(h.board),
							board: h.board
						});
					}
				}
			}

			let quotes = new Map<string, PriceQuote>();
			if (refMap.size > 0) {
				try {
					quotes = await fetchQuotes(Array.from(refMap.values()));
				} catch {
					// сеть недоступна — без бейджей, не критично
				}
			}

			for (const p of portfolios) {
				const items = holdingsByPortfolio.get(p.id) ?? [];
				if (items.length === 0) {
					summariesState.map.set(p.id, null);
					continue;
				}
				const { rows, totalValue } = computeAllocations(items, quotes);
				if (totalValue <= 0) {
					summariesState.map.set(p.id, null);
					continue;
				}
				summariesState.map.set(p.id, {
					maxDeviation: maxAbsDeviation(rows),
					totalValue,
					computedAt: Date.now()
				});
			}
		} finally {
			summariesState.loading = false;
			inflight = null;
		}
	})();
}

export function clearSummaries() {
	summariesState.map.clear();
	summariesState.loading = false;
	inflight = null;
	lastSig = '';
}
