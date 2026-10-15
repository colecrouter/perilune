export interface InstallPrompt extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: string }>;
}
export const installation = $state<{ prompt: InstallPrompt | null }>({ prompt: null });
