import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        rules: {
            // Error
            "@typescript-eslint/explicit-function-return-type": "error",
            "prefer-const": "error",
            eqeqeq: "error",
            "no-implicit-coercion": "error",
            "no-useless-assignment": "error",
            "prefer-arrow-callback": "error",
            "prefer-promise-reject-errors": "error",
            yoda: "error",

            // Lenient
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
]);
