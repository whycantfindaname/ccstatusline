const DEFAULT_RENDER_BUDGET_MS = 280;

export class RenderDeadline {
    private readonly expiresAt: number;

    constructor(
        budgetMs = DEFAULT_RENDER_BUDGET_MS,
        private readonly clock: () => number = () => performance.now()
    ) {
        this.expiresAt = this.clock() + Math.max(0, budgetMs);
    }

    remainingMs(): number {
        return Math.max(0, Math.floor(this.expiresAt - this.clock()));
    }

    expired(): boolean {
        return this.remainingMs() === 0;
    }

    limit(localLimitMs: number): number {
        const remaining = this.remainingMs();
        return remaining === 0
            ? 0
            : Math.min(Math.max(1, Math.floor(localLimitMs)), remaining);
    }
}

export const RENDER_BUDGET_MS = DEFAULT_RENDER_BUDGET_MS;
