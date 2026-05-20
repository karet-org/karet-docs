import { defineConfig } from "vitepress";

export default defineConfig({
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
  themeConfig: {
    siteTitle: "Karet docs",
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
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Templates", link: "/guide/templates" },
            { text: "Auto-runs (webhooks)", link: "/guide/webhooks" },
            { text: "Authentication", link: "/guide/authentication" },
            { text: "Deploying to AWS", link: "/guide/deploy-aws" },
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
});
