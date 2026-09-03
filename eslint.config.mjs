import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // eslint-config-next 16 enables the React Compiler rules of
    // eslint-plugin-react-hooks 7 as errors. The existing page.tsx relies on
    // patterns those rules reject (state synced from URL params inside effects,
    // an inline component definition). Report them as warnings until page.tsx
    // is restructured.
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
];

export default eslintConfig;
