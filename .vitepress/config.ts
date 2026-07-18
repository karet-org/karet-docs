import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(defineConfig({
  title: "Karet",
  description: "Self-hostable analytics platform: pipelines, dashboards, S3.",
  cleanUrls: true,
  lastUpdated: true,
  // Don't publish the package-local README.md (developer-facing notes)
  // as a public page on the rendered site.
  srcExclude: ["README.md"],
  // Doc references like http://localhost:3000 are intentional. They
  // point at the dev server the reader is supposed to run.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  // Karet logo favicon (matches the web app's nav logo and keeps the
  // docs site and the running instance feeling like one product).
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  ],
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "Karet",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/pipeline-config" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Self-hosting", link: "/guide/self-hosting" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Templates", link: "/guide/templates" },
            { text: "Auto-runs (webhooks)", link: "/guide/webhooks" },
            { text: "Authentication", link: "/guide/authentication" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Pipeline config", link: "/reference/pipeline-config" },
            { text: "Dashboard config", link: "/reference/dashboard-config" },
            { text: "Worker HTTP API", link: "/reference/worker-api" },
            { text: "Web HTTP API", link: "/reference/web-api" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/karet-org/karet" },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/karet-org/karet-docs/edit/main/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "MIT licensed",
      copyright: "© Karet contributors",
    },
  },
}));
