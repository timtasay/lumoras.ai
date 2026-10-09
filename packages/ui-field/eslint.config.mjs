import next from "eslint-config-next";

/** Same rules as the apps (eslint-config-next); a library has no pages/ dir and no local Next install. */
const config = [
  ...next,
  {
    settings: { react: { version: "19.3" }, next: { rootDir: "." } },
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  { ignores: ["node_modules/**"] },
];

export default config;
