<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { base } from '$app/paths';
	import { authState, initAuth, logout } from '$lib/stores/auth.svelte';

	let { children } = $props();

	onMount(() => {
		initAuth();
	});
</script>

<svelte:head>
	<link rel="icon" href="{base}{favicon}" />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="border-surface-300-700 border-b">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
			<a href="{base}/" class="text-lg font-semibold tracking-tight">InvestHelper</a>
			<nav class="flex items-center gap-3 text-sm">
				{#if authState.status === 'authorized' || authState.status === 'denied'}
					<span class="opacity-70">{authState.user?.email}</span>
					<button class="btn btn-sm preset-tonal" onclick={logout}>Выйти</button>
				{/if}
			</nav>
		</div>
	</header>

	<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
		{@render children()}
	</main>

	<footer class="border-surface-300-700 border-t text-center text-xs opacity-60">
		<div class="px-4 py-3">
			Котировки MOEX ISS, задержка ~15 минут. Не является инвестиционной рекомендацией.
		</div>
	</footer>
</div>
