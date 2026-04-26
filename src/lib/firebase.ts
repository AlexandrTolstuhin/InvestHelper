import { browser } from '$app/environment';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
	initializeAppCheck,
	ReCaptchaV3Provider,
	type AppCheck
} from 'firebase/app-check';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const config = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app: FirebaseApp | undefined;
let appCheck: AppCheck | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function ensureApp(): FirebaseApp {
	if (!browser) {
		throw new Error('Firebase инициализируется только в браузере');
	}
	if (!config.apiKey || !config.projectId) {
		throw new Error(
			'Не заданы переменные VITE_FIREBASE_*. Скопируйте .env.example в .env.local и заполните.'
		);
	}
	if (app) return app;

	app = initializeApp(config);

	const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
	if (siteKey) {
		const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
		if (debugToken) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
		}
		appCheck = initializeAppCheck(app, {
			provider: new ReCaptchaV3Provider(siteKey),
			isTokenAutoRefreshEnabled: true
		});
	}

	return app;
}

export function getFirebaseAuth(): Auth {
	if (!auth) auth = getAuth(ensureApp());
	return auth;
}

export function getDb(): Firestore {
	if (!db) db = getFirestore(ensureApp());
	return db;
}

export function getAppCheckInstance(): AppCheck | undefined {
	ensureApp();
	return appCheck;
}
