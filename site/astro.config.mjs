// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://policywright.lemmalabs.space',
  // Quotes and dashes render exactly as typed: outputs and the provenance
  // sentence on this site are quoted verbatim and must grep-match the source.
  markdown: { smartypants: false },
  integrations: [
    starlight({
      title: 'Policywright',
      description:
        'Record a Soroban transaction, then synthesize the least-privilege OpenZeppelin smart-account authorization that permits exactly that flow.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/kunal-drall/policywright',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Overview', link: '/' },
        { label: 'Architecture', slug: 'architecture' },
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'Concepts',
          items: [
            { label: 'Context rules', slug: 'concepts/context-rules' },
            { label: 'Policies', slug: 'concepts/policies' },
            { label: 'Least-privilege model', slug: 'concepts/least-privilege' },
            { label: 'Compose vs. generate', slug: 'concepts/compose-first' },
          ],
        },
        {
          label: 'Use cases',
          items: [
            {
              label: 'Agent yield operations',
              slug: 'use-cases/agent-yield-operations',
              badge: { text: 'Shipped', variant: 'success' },
            },
            {
              label: 'Recurring payments (SEP-41)',
              slug: 'use-cases/recurring-payments-sep41',
              badge: { text: 'Planned walkthrough', variant: 'note' },
            },
            {
              label: 'Bounded trading delegation',
              slug: 'use-cases/bounded-trading-delegation',
              badge: { text: 'Planned walkthrough', variant: 'note' },
            },
            { label: 'Why least-privilege for agents', slug: 'use-cases/why-least-privilege-for-agents' },
          ],
        },
        { label: 'Security', slug: 'security' },
        { label: 'Roadmap', slug: 'roadmap' },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Dry run & argument scope', slug: 'reference/dry-run-harness' },
            { label: 'Smart-account install', slug: 'reference/smart-account-install' },
            { label: 'MCP server', slug: 'reference/mcp-tools' },
            { label: 'The skill', slug: 'reference/skill' },
          ],
        },
        { label: 'Changelog', slug: 'changelog' },
      ],
    }),
  ],
});
