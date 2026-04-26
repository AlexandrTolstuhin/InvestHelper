<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import { authState } from '$lib/stores/auth.svelte';
	import {
		cleanup,
		createPortfolio,
		deletePortfolio,
		portfoliosState,
		watchPortfolios
	} from '$lib/stores/portfolios.svelte';

	let newName = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);

	$effect(() => {
		// Реактивно реагируем на изменение статуса авторизации.
		if (authState.status === 'authorized') {
			watchPortfolios();
		}
	});

	onDestroy(cleanup);

	async function onCreate(e: Event) {
		e.preventDefault();
		const name = newName.trim();
		if (!name) return;
		creating = true;
		createError = null;
		try {
			const id = await createPortfolio(name);
			newName = '';
			await goto(resolve('/portfolio/[id]', { id }));
		} catch (err) {
			createError = (err as Error).message;
		} finally {
			creating = false;
		}
	}

	async function onDelete(id: string, name: string) {
		if (!confirm(`Удалить портфель «${name}»? Холдинги внутри не удаляются автоматически.`)) {
			return;
		}
		try {
			await deletePortfolio(id);
		} catch (err) {
			alert((err as Error).message);
		}
	}
</script>

<AuthGuard>
	<section class="space-y-6">
		<header class="flex items-end justify-between gap-4">
			<h1 class="h2">Портфели</h1>
		</header>

		<form class="card preset-tonal flex flex-wrap gap-2 p-4" onsubmit={onCreate}>
			<input
				class="input flex-1 min-w-48"
				type="text"
				placeholder="Название нового портфеля"
				maxlength="100"
				bind:value={newName}
				disabled={creating}
			/>
			<button
				class="btn preset-filled-primary-500"
				type="submit"
				disabled={creating || !newName.trim()}
			>
				{creating ? 'Создаю…' : 'Создать'}
			</button>
		</form>

		{#if createError}
			<p class="text-error-500 text-sm">{createError}</p>
		{/if}

		{#if portfoliosState.loading}
			<p class="opacity-70">Загружаем список…</p>
		{:else if portfoliosState.error}
			<p class="text-error-500">{portfoliosState.error}</p>
		{:else if portfoliosState.items.length === 0}
			<div class="card preset-tonal p-6 text-center opacity-70">
				У вас пока нет портфелей. Создайте первый — например, «Вечный портфель».
			</div>
		{:else}
			<ul class="space-y-2">
				{#each portfoliosState.items as p (p.id)}
					<li
					class="card preset-tonal border-surface-200-800 hover:bg-surface-100-900 flex items-center justify-between gap-3 border p-4 transition"
				>
						<a
						class="anchor flex-1 text-base font-medium"
						href={resolve('/portfolio/[id]', { id: p.id })}
					>
							{p.name}
						</a>
						<button
							class="btn btn-sm preset-tonal-error"
							type="button"
							onclick={() => onDelete(p.id, p.name)}
						>
							Удалить
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</AuthGuard>
