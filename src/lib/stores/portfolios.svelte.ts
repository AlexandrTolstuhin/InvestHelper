import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	updateDoc,
	type Timestamp,
	type Unsubscribe
} from 'firebase/firestore';
import { getDb } from '$lib/firebase';
import { authState } from '$lib/stores/auth.svelte';

export interface Portfolio {
	id: string;
	name: string;
	createdAt: Timestamp | null;
	updatedAt: Timestamp | null;
}

interface PortfoliosState {
	loading: boolean;
	error: string | null;
	items: Portfolio[];
}

const state = $state<PortfoliosState>({
	loading: true,
	error: null,
	items: []
});

let unsubscribe: Unsubscribe | null = null;
let watchedUid: string | null = null;

export function watchPortfolios() {
	const uid = authState.user?.uid ?? null;
	if (uid === watchedUid) return;
	cleanup();
	watchedUid = uid;
	if (!uid || authState.status !== 'authorized') {
		state.loading = false;
		state.items = [];
		return;
	}
	state.loading = true;
	state.error = null;
	const q = query(
		collection(getDb(), 'users', uid, 'portfolios'),
		orderBy('createdAt', 'asc')
	);
	unsubscribe = onSnapshot(
		q,
		(snap) => {
			state.items = snap.docs.map((d) => {
				const data = d.data() as Omit<Portfolio, 'id'>;
				return {
					id: d.id,
					name: data.name,
					createdAt: data.createdAt ?? null,
					updatedAt: data.updatedAt ?? null
				};
			});
			state.loading = false;
		},
		(err) => {
			state.error = err.message;
			state.loading = false;
		}
	);
}

export function cleanup() {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	watchedUid = null;
	state.items = [];
	state.loading = true;
	state.error = null;
}

export async function createPortfolio(name: string): Promise<string> {
	const uid = requireUid();
	const ref = await addDoc(collection(getDb(), 'users', uid, 'portfolios'), {
		name: name.trim(),
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
	return ref.id;
}

export async function renamePortfolio(id: string, name: string) {
	const uid = requireUid();
	await updateDoc(doc(getDb(), 'users', uid, 'portfolios', id), {
		name: name.trim(),
		updatedAt: serverTimestamp()
	});
}

export async function deletePortfolio(id: string) {
	const uid = requireUid();
	// Холдинги — отдельная подколлекция; Firestore сам не каскадит.
	// На уровне UI будем удалять только пустые портфели до реализации очистки.
	await deleteDoc(doc(getDb(), 'users', uid, 'portfolios', id));
}

function requireUid(): string {
	const uid = authState.user?.uid;
	if (!uid || authState.status !== 'authorized') {
		throw new Error('Не авторизованы или нет доступа');
	}
	return uid;
}

export const portfoliosState = state;
