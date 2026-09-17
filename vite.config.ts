import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // Project page on GitHub Pages is served from /<repo-name>/, not /.
  base: "/Agro-drifter/",
  server: {
    host: true,
  },
});
