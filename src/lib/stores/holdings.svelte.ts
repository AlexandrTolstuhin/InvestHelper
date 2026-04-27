import {
	collection,
	deleteDoc,
	doc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	updateDoc,
	writeBatch,
	Timestamp,
	type Unsubscribe
} from 'firebase/firestore';
import { describeFirestoreError, getDb } from '$lib/firebase';
import { authState } from '$lib/stores/auth.svelte';

export interface Holding {
	id: string; // === ticker
	ticker: string;
	board: string;
	quantity: number;
	lotsize: number;
	targetPercent: number;
	shortName: string;
	customName: string | null;
	createdAt: Date | null;
}

export function holdingDisplayName(
	h: Pick<Holding, 'customName' | 'shortName' | 'ticker'>
): string {
	const custom = h.customName?.trim();
	if (custom) return custom;
	return h.shortName || h.ticker;
}

interface HoldingsState {
	loading: boolean;
	error: string | null;
	items: Holding[];
}

const states = new Map<string, HoldingsState>();
const subs = new Map<string, Unsubscribe>();
const migratedPortfolios = new Set<string>();

function createHoldingsState(): HoldingsState {
	const s = $state<HoldingsState>({ loading: true, error: null, items: [] });
	return s;
}

export function getHoldingsState(portfolioId: string): HoldingsState {
	let s = states.get(portfolioId);
	if (!s) {
		s = createHoldingsState();
		states.set(portfolioId, s);
	}
	return s;
}

export function watchHoldings(portfolioId: string) {
	const uid = requireUid();
	if (subs.has(portfolioId)) return;
	const s = getHoldingsState(portfolioId);
	s.loading = true;
	s.error = null;
	const q = query(
		collection(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings'),
		orderBy('ticker', 'asc')
	);
	const unsub = onSnapshot(
		q,
		(snap) => {
			s.items = snap.docs.map((d) => {
				const data = d.data();
				const ts = data.createdAt as Timestamp | undefined;
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
			s.loading = false;
			if (!migratedPortfolios.has(portfolioId)) {
				migratedPortfolios.add(portfolioId);
				migrateHoldings(portfolioId, s.items).catch((err) => {
					console.warn('migrateHoldings failed', err);
				});
			}
		},
		(err) => {
			s.error = describeFirestoreError(err);
			s.loading = false;
		}
	);
	subs.set(portfolioId, unsub);
}

export function unwatchHoldings(portfolioId: string) {
	const u = subs.get(portfolioId);
	if (u) {
		u();
		subs.delete(portfolioId);
	}
}

export interface UpsertHoldingInput {
	ticker: string;
	board: string;
	quantity: number;
	lotsize: number;
	targetPercent: number;
	shortName: string;
	customName?: string | null;
}

export async function upsertHolding(portfolioId: string, input: UpsertHoldingInput) {
	const uid = requireUid();
	const ticker = input.ticker.trim().toUpperCase();
	if (!ticker) throw new Error('Пустой тикер');

	const holdingRef = doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker);
	const batch = writeBatch(getDb());
	batch.set(holdingRef, {
		ticker,
		board: input.board,
		quantity: input.quantity,
		lotsize: input.lotsize,
		targetPercent: input.targetPercent,
		shortName: input.shortName,
		customName: input.customName?.trim() ? input.customName.trim() : null,
		createdAt: serverTimestamp()
	});

	if (input.quantity > 0) {
		const lotsize = Math.max(1, input.lotsize || 1);
		const lots = Math.max(1, Math.floor(input.quantity / lotsize));
		const txnRef = doc(
			getDb(),
			'users',
			uid,
			'portfolios',
			portfolioId,
			'transactions',
			`initial-${ticker}`
		);
		batch.set(txnRef, {
			ticker,
			kind: 'initial',
			lots,
			lotsize,
			qty: input.quantity,
			date: serverTimestamp()
		});
	}

	await batch.commit();
}

export async function patchHolding(
	portfolioId: string,
	ticker: string,
	patch: Partial<Pick<UpsertHoldingInput, 'targetPercent' | 'lotsize' | 'customName'>>
) {
	const uid = requireUid();
	const payload: Record<string, unknown> = { ...patch };
	if ('customName' in payload) {
		const v = payload.customName;
		payload.customName = typeof v === 'string' && v.trim() ? v.trim() : null;
	}
	await updateDoc(
		doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker),
		payload
	);
}

export async function removeHolding(portfolioId: string, ticker: string) {
	const uid = requireUid();
	await deleteDoc(doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker));
}

async function migrateHoldings(portfolioId: string, items: Holding[]) {
	const needsMigration = items.filter((h) => !h.createdAt);
	if (needsMigration.length === 0) return;
	const uid = requireUid();
	const batch = writeBatch(getDb());
	for (const h of needsMigration) {
		const holdingRef = doc(
			getDb(),
			'users',
			uid,
			'portfolios',
			portfolioId,
			'holdings',
			h.ticker
		);
		batch.update(holdingRef, { createdAt: serverTimestamp() });

		if (h.quantity > 0) {
			const lotsize = Math.max(1, h.lotsize || 1);
			const lots = Math.max(1, Math.floor(h.quantity / lotsize));
			const txnRef = doc(
				getDb(),
				'users',
				uid,
				'portfolios',
				portfolioId,
				'transactions',
				`initial-${h.ticker}`
			);
			batch.set(
				txnRef,
				{
					ticker: h.ticker,
					kind: 'initial',
					lots,
					lotsize,
					qty: h.quantity,
					date: serverTimestamp()
				},
				{ merge: false }
			);
		}
	}
	await batch.commit();
}

function requireUid(): string {
	const uid = authState.user?.uid;
	if (!uid || authState.status !== 'authorized') {
		throw new Error('Не авторизованы');
	}
	return uid;
}
