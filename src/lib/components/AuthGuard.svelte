<script lang="ts">
	import { authState, loginWithGoogle } from '$lib/stores/auth.svelte';

	let { children } = $props<{ children: () => unknown }>();

	let pending = $state(false);
	let loginError = $state<string | null>(null);

	async function login() {
		pending = true;
		loginError = null;
		try {
			await loginWithGoogle();
		} catch (e) {
			loginError = (e as Error).message;
		} finally {
			pending = false;
		}
	}
</script>

{#if authState.status === 'loading'}
	<div class="flex items-center gap-2 opacity-70">
		<span class="loader inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
		></span>
		Загрузка…
	</div>
{:else if authState.status === 'authorized'}
	{@render children()}
{:else if authState.status === 'denied'}
	<div class="card preset-tonal-warning space-y-3 p-4">
		<h2 class="h4">Доступ не выдан</h2>
		<p class="opacity-80">
			Вход выполнен ({authState.user?.email}), но этот email не входит в список разрешённых.
			Попросите владельца приложения добавить ваш адрес в коллекцию
			<code>allowedEmails</code>.
		</p>
	</div>
{:else}
	<div class="card preset-tonal space-y-4 p-6 text-center">
		<h2 class="h3">Войдите, чтобы продолжить</h2>
		<p class="opacity-70">
			Данные ваших портфелей хранятся в облаке и привязаны к Google-аккаунту.
		</p>
		<button class="btn preset-filled-primary-500" onclick={login} disabled={pending}>
			{pending ? 'Открываем окно Google…' : 'Войти через Google'}
		</button>
		{#if loginError}
			<p class="text-error-500 text-sm">{loginError}</p>
		{/if}
	</div>
{/if}
