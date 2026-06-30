export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, clients, triageConfigs } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { workflowMeta } from '@sprigly/workflows';
import { TriageConfigEditor } from './editor';
import type { InitialTriageConfig } from './editor';
import type { TriageCategory, ReplyExample } from '@sprigly/engine';

async function getClient(id: string) {
  const rows = await db
    .select({ id: clients.id, name: clients.name, verifiedDomain: clients.verifiedDomain })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getTriageConfig(clientId: string) {
  const rows = await db
    .select()
    .from(triageConfigs)
    .where(eq(triageConfigs.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export default async function TriageConfigClientPage({ params }: { params: { clientId: string } }) {
  const [client, config] = await Promise.all([
    getClient(params.clientId),
    getTriageConfig(params.clientId),
  ]);

  if (client === null) notFound();

  const initial: InitialTriageConfig = {
    digestCadence:          config?.digestCadence ?? 'end_of_day',
    categories:             (config?.categories ?? []) as unknown as TriageCategory[],
    voiceSample:            config?.voiceSample ?? '',
    replyExamples:          (config?.replyExamples ?? []) as unknown as ReplyExample[],
    additionalInstructions: config?.additionalInstructions ?? '',
    verifiedDomain:         client.verifiedDomain ?? '',
  };

  // Exclude triage and noop from invoke_workflow targets:
  // - sprigly-inbox-triage: circular routing risk (triage invoking itself)
  // - sprigly-inbox-noop: not a meaningful action target
  const EXCLUDED_INVOKE_TARGETS = new Set(['sprigly-inbox-triage', 'sprigly-inbox-noop']);
  const invokeTargets = workflowMeta
    .filter((w) => !EXCLUDED_INVOKE_TARGETS.has(w.id))
    .map((w) => ({ id: w.id, name: w.name }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/triage-config" className="text-sm text-gray-500 hover:text-gray-700">
          ← Triage Config
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{client.name}</h1>
        <p className="text-sm text-gray-500 mt-1">Triage configuration for inbox workflow</p>
      </div>

      <TriageConfigEditor
        clientId={params.clientId}
        clientName={client.name}
        initial={initial}
        invokeTargets={invokeTargets}
      />
    </div>
  );
}
