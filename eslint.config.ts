import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config([
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "prefer-const": "error",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
]);
