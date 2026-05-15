const BOLD_RED = "\e[1;31m";
const RESET = "\e[0m";

export function error_and_quit(error: string): never {
    console.log(`${BOLD_RED}${error}${RESET}`);
    process.exit(1);
}
