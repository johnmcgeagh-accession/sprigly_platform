import { db, knowledgeTopics } from './index.js';
import { sql } from './client.js';

const clientId = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';

const topics = [
  {
    name: 'sizing',
    description: "Questions about how much effort or resource an engagement needs: team size, number of people, hours or days of work, or what makes a project larger or smaller. Key signal: a quantity question — 'how many', 'how big', 'how much resource'. NOT about which activities are included (that is scope).",
  },
  {
    name: 'pricing',
    description: "Questions about cost, fees, day rates, retainers, payment terms, invoicing cadence, or how pricing is structured. Key signal: any reference to money, rates, or 'how much'.",
  },
  {
    name: 'process',
    description: "Questions about how Sprigly works operationally: onboarding steps, how a project is run, collaboration methods, tooling, communication cadence, reporting, or the sequence of steps in a typical engagement. Key signal: 'how do you work', 'what does day-to-day look like'.",
  },
  {
    name: 'timelines',
    description: "Questions about when something starts, ends, or is delivered: lead times, typical project duration, turnaround, availability, or milestone timing. Key signal: 'when', 'how long', 'how quickly'.",
  },
  {
    name: 'scope',
    description: "Questions about which activities are in or out of an engagement: whether a specific task or deliverable is included, exclusions, or where Sprigly's responsibility starts and stops. Key signal: a boundary question — 'do you do X', 'is X included', 'is X your job or ours'. NOT about how much effort it takes (that is sizing).",
  },
  {
    name: 'technical',
    description: "Questions about technical specifics: system integrations, data handling, security, platform compatibility, or whether Sprigly works with a particular tool or technology. Key signal: mentions a specific tool, platform, or technical requirement.",
  },
];

for (const t of topics) {
  await db.insert(knowledgeTopics).values({ clientId, name: t.name, description: t.description });
}

console.log(`Inserted ${topics.length} knowledge_topics for Sprigly.`);
await sql.end();
process.exit(0);
