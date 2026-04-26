import {
	collection,
	doc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	writeBatch,
	Timestamp,
	type Unsubscribe
} from 'firebase/firestore';
import { describeFirestoreError, getDb } from '$lib/firebase';
import { authState } from '$lib/stores/auth.svelte';
import { getHoldingsState } from '$lib/stores/holdings.svelte';

export type TransactionKind = 'initial' | 'buy' | 'sell';

export interface Transaction {
	id: string;
	ticker: string;
	kind: TransactionKind;
	lots: number;
	lotsize: number;
	qty: number;
	date: Date | null;
}

interface TransactionsState {
	loading: boolean;
	error: string | null;
	items: Transaction[];
}

const states = new Map<string, TransactionsState>();
const subs = new Map<string, Unsubscribe>();

function createState(): TransactionsState {
	const s = $state<TransactionsState>({ loading: true, error: null, items: [] });
	return s;
}

export function getTransactionsState(portfolioId: string): TransactionsState {
	let s = states.get(portfolioId);
	if (!s) {
		s = createState();
		states.set(portfolioId, s);
	}
	return s;
}

export function watchTransactions(portfolioId: string) {
	const uid = requireUid();
	if (subs.has(portfolioId)) return;
	const s = getTransactionsState(portfolioId);
	s.loading = true;
	s.error = null;
	const q = query(
		collection(getDb(), 'users', uid, 'portfolios', portfolioId, 'transactions'),
		orderBy('date', 'asc')
	);
	const unsub = onSnapshot(
		q,
		(snap) => {
			s.items = snap.docs.map((d) => {
				const data = d.data();
				const ts = data.date as Timestamp | undefined;
				return {
					id: d.id,
					ticker: String(data.ticker ?? ''),
					kind: (data.kind ?? 'buy') as TransactionKind,
					lots: Number(data.lots ?? 0),
					lotsize: Number(data.lotsize ?? 1),
					qty: Number(data.qty ?? 0),
					date: ts ? ts.toDate() : null
				};
			});
			s.loading = false;
		},
		(err) => {
			s.error = describeFirestoreError(err);
			s.loading = false;
		}
	);
	subs.set(portfolioId, unsub);
}

export function unwatchTransactions(portfolioId: string) {
	const u = subs.get(portfolioId);
	if (u) {
		u();
		subs.delete(portfolioId);
	}
}

export async function recordBuy(portfolioId: string, ticker: string, lots: number) {
	if (!Number.isFinite(lots) || lots <= 0) throw new Error('Количество лотов должно быть > 0');
	await applyOps(portfolioId, [{ ticker, lots, kind: 'buy' }]);
}

export async function recordSell(portfolioId: string, ticker: string, lots: number) {
	if (!Number.isFinite(lots) || lots <= 0) throw new Error('Количество лотов должно быть > 0');
	await applyOps(portfolioId, [{ ticker, lots, kind: 'sell' }]);
}

export interface RebalanceOp {
	ticker: string;
	lots: number; // знаковое: + покупка, − продажа
}

export async function applyRebalance(portfolioId: string, ops: RebalanceOp[]) {
	const normalized: InternalOp[] = ops
		.filter((o) => Number.isFinite(o.lots) && o.lots !== 0)
		.map((o) => ({
			ticker: o.ticker,
			lots: Math.abs(o.lots),
			kind: o.lots > 0 ? 'buy' : 'sell'
		}));
	if (normalized.length === 0) return;
	await applyOps(portfolioId, normalized);
}

interface InternalOp {
	ticker: string;
	lots: number; // положительное
	kind: 'buy' | 'sell';
}

async function applyOps(portfolioId: string, ops: InternalOp[]) {
	const uid = requireUid();
	const holdingsState = getHoldingsState(portfolioId);
	const byTicker = new Map(holdingsState.items.map((h) => [h.ticker, h]));

	const batch = writeBatch(getDb());
	const newQuantities = new Map<string, number>();

	for (const op of ops) {
		const h = byTicker.get(op.ticker);
		if (!h) throw new Error(`Бумаги ${op.ticker} нет в портфеле`);
		const lotsize = Math.max(1, h.lotsize || 1);
		const qtyDelta = op.lots * lotsize * (op.kind === 'sell' ? -1 : 1);
		const baseQty = newQuantities.get(op.ticker) ?? h.quantity;
		const newQty = baseQty + qtyDelta;
		if (newQty < 0) {
			throw new Error(`У ${op.ticker} нельзя продать больше, чем есть (сейчас ${baseQty} шт.)`);
		}
		newQuantities.set(op.ticker, newQty);

		const txnRef = doc(
			collection(getDb(), 'users', uid, 'portfolios', portfolioId, 'transactions')
		);
		batch.set(txnRef, {
			ticker: op.ticker,
			kind: op.kind,
			lots: op.lots,
			lotsize,
			qty: qtyDelta,
			date: serverTimestamp()
		});

		const holdingRef = doc(
			getDb(),
			'users',
			uid,
			'portfolios',
			portfolioId,
			'holdings',
			op.ticker
		);
		batch.update(holdingRef, { quantity: newQty });
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
