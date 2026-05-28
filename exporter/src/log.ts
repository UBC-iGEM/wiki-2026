const BOLD_RED = "\x1b[1;31m";
const BOLD_YELLOW = "\x1b[1;33m";
const RESET = "\x1b[0m";

export function error_and_quit(error: Error | string): never {
    log_error({ error, ansi_color: BOLD_RED });
    process.exit(1);
}

export function warn_error(error: Error | string) {
    log_error({ error, ansi_color: BOLD_YELLOW });
}

function log_error({ error, ansi_color }: { error: Error | string; ansi_color: string }) {
    if (typeof error === "string") error = new Error(error);
    console.error(`${ansi_color}${error.stack}${RESET}`);
}
