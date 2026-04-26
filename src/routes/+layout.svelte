<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { asset, resolve } from '$app/paths';
	import { authState, initAuth, logout } from '$lib/stores/auth.svelte';
	import { initTheme, themeState, toggleTheme } from '$lib/stores/theme.svelte';

	let { children } = $props();

	onMount(() => {
		initAuth();
		initTheme();
	});
</script>

<svelte:head>
	<link rel="icon" href={asset(favicon)} />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header
		class="bg-surface-50/80 dark:bg-surface-900/80 border-surface-200-800 sticky top-0 z-10 border-b backdrop-blur"
	>
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
			<a href={resolve('/')} class="text-lg font-semibold tracking-tight">InvestHelper</a>
			<nav class="flex items-center gap-3 text-sm">
				{#if authState.status === 'authorized' || authState.status === 'denied'}
					<span class="hidden opacity-70 sm:inline">{authState.user?.email}</span>
					<button class="btn btn-sm preset-tonal" onclick={logout}>Выйти</button>
				{/if}
				<button
					class="btn-icon btn-icon-sm preset-tonal"
					type="button"
					onclick={toggleTheme}
					aria-label={themeState.mode === 'dark'
						? 'Переключить на светлую тему'
						: 'Переключить на тёмную тему'}
					title={themeState.mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
				>
					<svg
						class="dark:hidden"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2" />
						<path d="M12 20v2" />
						<path d="m4.93 4.93 1.41 1.41" />
						<path d="m17.66 17.66 1.41 1.41" />
						<path d="M2 12h2" />
						<path d="M20 12h2" />
						<path d="m6.34 17.66-1.41 1.41" />
						<path d="m19.07 4.93-1.41 1.41" />
					</svg>
					<svg
						class="hidden dark:block"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
					</svg>
				</button>
			</nav>
		</div>
	</header>

	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
		{@render children()}
	</main>

	<footer
		class="bg-surface-100-900 border-surface-200-800 border-t text-center text-xs opacity-70"
	>
		<div class="px-4 py-3">
			Котировки MOEX ISS, задержка ~15 минут. Не является инвестиционной рекомендацией.
		</div>
	</footer>
</div>
