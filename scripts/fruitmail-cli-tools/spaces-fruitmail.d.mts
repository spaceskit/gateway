export declare function resolveFruitMailExecutable(): string | undefined;
export declare function buildFruitMailCommandArgs(operation: string, payload?: Record<string, unknown>): string[] | null;
export declare function runFruitMail(executable: string | undefined, operation: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
