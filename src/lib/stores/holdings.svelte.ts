import {
	collection,
	deleteDoc,
	doc,
	onSnapshot,
	orderBy,
	query,
	setDoc,
	updateDoc,
	type Unsubscribe
} from 'firebase/firestore';
import { getDb } from '$lib/firebase';
import { authState } from '$lib/stores/auth.svelte';

export interface Holding {
	id: string; // === ticker
	ticker: string;
	board: string;
	quantity: number;
	lotsize: number;
	targetPercent: number;
	shortName: string;
}

interface HoldingsState {
	loading: boolean;
	error: string | null;
	items: Holding[];
}

const states = new Map<string, HoldingsState>();
const subs = new Map<string, Unsubscribe>();

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
				return {
					id: d.id,
					ticker: String(data.ticker ?? d.id),
					board: String(data.board ?? ''),
					quantity: Number(data.quantity ?? 0),
					lotsize: Number(data.lotsize ?? 1),
					targetPercent: Number(data.targetPercent ?? 0),
					shortName: String(data.shortName ?? d.id)
				};
			});
			s.loading = false;
		},
		(err) => {
			s.error = err.message;
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
}

export async function upsertHolding(portfolioId: string, input: UpsertHoldingInput) {
	const uid = requireUid();
	const ticker = input.ticker.trim().toUpperCase();
	if (!ticker) throw new Error('Пустой тикер');
	const ref = doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker);
	await setDoc(ref, {
		ticker,
		board: input.board,
		quantity: input.quantity,
		lotsize: input.lotsize,
		targetPercent: input.targetPercent,
		shortName: input.shortName
	});
}

export async function patchHolding(
	portfolioId: string,
	ticker: string,
	patch: Partial<Pick<UpsertHoldingInput, 'quantity' | 'targetPercent' | 'lotsize'>>
) {
	const uid = requireUid();
	await updateDoc(doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker), patch);
}

export async function removeHolding(portfolioId: string, ticker: string) {
	const uid = requireUid();
	await deleteDoc(doc(getDb(), 'users', uid, 'portfolios', portfolioId, 'holdings', ticker));
}

function requireUid(): string {
	const uid = authState.user?.uid;
	if (!uid || authState.status !== 'authorized') {
		throw new Error('Не авторизованы');
	}
	return uid;
}
