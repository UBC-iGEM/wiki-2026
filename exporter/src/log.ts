const BOLD_RED = "\x1b[1;31m";
const BOLD_YELLOW = "\x1b[1;33m";
const RESET = "\x1b[0m";

export function errorAndQuit(error: Error | string): never {
    logError({ error, ansi_color: BOLD_RED });
    process.exit(1);
}

export function warnError(error: Error | string): void {
    logError({ error, ansi_color: BOLD_YELLOW });
}

function logError({ error, ansi_color }: { error: Error | string; ansi_color: string }): void {
    if (typeof error === "string") error = new Error(error);
    console.error(`${ansi_color}${error.stack}${RESET}`);
}
