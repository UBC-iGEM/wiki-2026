import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
    {
        files: ["**/*.ts"],
    },
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/explicit-function-return-type": "error",
            "prefer-const": "error",
            eqeqeq: "error",
            "no-implicit-coercion": "error",
            "no-useless-assignment": "error",
            "prefer-arrow-callback": "error",
            "prefer-promise-reject-errors": "error",
            yoda: "warn",
        },
    },
]);
