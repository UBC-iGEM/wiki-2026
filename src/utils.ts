export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}
