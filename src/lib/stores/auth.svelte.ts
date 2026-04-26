import { browser } from '$app/environment';
import {
	GoogleAuthProvider,
	signInWithPopup,
	signOut,
	onAuthStateChanged,
	type User
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '$lib/firebase';

export type AuthStatus = 'loading' | 'anonymous' | 'authorized' | 'denied';

interface AuthState {
	status: AuthStatus;
	user: User | null;
	error: string | null;
}

const state = $state<AuthState>({
	status: 'loading',
	user: null,
	error: null
});

let initialized = false;

export function initAuth() {
	if (!browser || initialized) return;
	initialized = true;
	const auth = getFirebaseAuth();
	onAuthStateChanged(
		auth,
		async (user) => {
			if (!user) {
				state.user = null;
				state.status = 'anonymous';
				state.error = null;
				return;
			}
			state.user = user;
			state.status = 'loading';
			try {
				const allowed = await isEmailAllowed(user.email);
				state.status = allowed ? 'authorized' : 'denied';
				state.error = allowed ? null : 'Этот аккаунт не входит в список разрешённых.';
			} catch (e) {
				state.status = 'denied';
				state.error = (e as Error).message;
			}
		},
		(err) => {
			state.status = 'anonymous';
			state.error = err.message;
		}
	);
}

async function isEmailAllowed(email: string | null): Promise<boolean> {
	if (!email) return false;
	// Допускаем оба ID документа: исходный email и lower-case (нормализация на стороне владельца).
	const db = getDb();
	const variants = Array.from(new Set([email, email.toLowerCase()]));
	for (const id of variants) {
		const snap = await getDoc(doc(db, 'allowedEmails', id));
		if (snap.exists()) return true;
	}
	return false;
}

export async function loginWithGoogle() {
	const auth = getFirebaseAuth();
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });
	await signInWithPopup(auth, provider);
}

export async function logout() {
	await signOut(getFirebaseAuth());
}

export const authState = state;
