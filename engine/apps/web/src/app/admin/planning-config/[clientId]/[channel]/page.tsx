export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, clients, clientChannels, clientPlanningConfig } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { PlanningConfigEditor } from './editor';
import type { InitialPlanningConfig } from './editor';
import type { Pillar, Cadence, RecurringSeries, PostingTimes } from '@sprigly/engine';

async function getClient(id: string) {
  const rows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getChannel(clientId: string, channel: string) {
  const rows = await db
    .select({ id: clientChannels.id })
    .from(clientChannels)
    .where(
      and(
        eq(clientChannels.clientId, clientId),
        eq(clientChannels.channel, channel),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getPlanningConfig(clientId: string, channel: string) {
  const rows = await db
    .select()
    .from(clientPlanningConfig)
    .where(
      and(
        eq(clientPlanningConfig.clientId, clientId),
        eq(clientPlanningConfig.channel, channel),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export default async function PlanningConfigChannelPage({
  params,
}: {
  params: { clientId: string; channel: string };
}) {
  const { clientId, channel } = params;

  const [client, channelRow, config] = await Promise.all([
    getClient(clientId),
    getChannel(clientId, channel),
    getPlanningConfig(clientId, channel),
  ]);

  if (client === null || channelRow === null) notFound();

  const initial: InitialPlanningConfig = {
    pillars:         (config?.pillars         ?? []) as unknown as Pillar[],
    competitors:     (config?.competitors      ?? []) as string[],
    cadence:         (config?.cadence          ?? {}) as unknown as Cadence,
    recurringSeries: (config?.recurringSeries  ?? []) as unknown as RecurringSeries[],
    postingTimes:    (config?.postingTimes     ?? {}) as unknown as PostingTimes,
    categories:      (config?.categories       ?? []) as string[],
  };

  const channelLabel = channel.charAt(0).toUpperCase() + channel.slice(1);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/planning-config" className="text-sm text-gray-500 hover:text-gray-700">
          ← Planning Config
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">
          {client.name}{' '}
          <span className="text-gray-400 font-normal text-xl">— {channelLabel}</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Planning configuration for the content-cycle planning phase
        </p>
      </div>

      <PlanningConfigEditor
        clientId={clientId}
        clientName={client.name}
        channel={channel}
        initial={initial}
      />
    </div>
  );
}
