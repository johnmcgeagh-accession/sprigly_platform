export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { workflowMeta, type WorkflowMeta, type WorkflowStepMeta } from '@sprigly/workflows';
import { db, promptTemplates } from '@sprigly/db';
import { and, eq, isNull, desc } from 'drizzle-orm';

async function getSharedPromptStatus(workflowId: string, stepName: string) {
  const rows = await db
    .select({ id: promptTemplates.id, version: promptTemplates.version })
    .from(promptTemplates)
    .where(
      and(
        isNull(promptTemplates.clientId),
        eq(promptTemplates.workflowId, workflowId),
        eq(promptTemplates.stepName, stepName),
      ),
    )
    .orderBy(desc(promptTemplates.version))
    .limit(1);
  return rows[0] ?? null;
}

export default async function WorkflowDetailPage({ params }: { params: { id: string } }) {
  const workflow = workflowMeta.find((w) => w.id === params.id);
  if (!workflow) notFound();

  const stepsWithPrompts = await Promise.all(
    workflow.steps.map(async (step: WorkflowStepMeta) => {
      const sharedPrompt = step.requiresPrompt
        ? await getSharedPromptStatus(workflow.id, step.stepName)
        : null;
      return { ...step, sharedPrompt };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/workflows" className="text-sm text-gray-500 hover:text-gray-700">
          ← Workflows
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{workflow.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{workflow.description}</p>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Default destinations</h2>
        <div className="space-y-2">
          {workflow.defaultDestinations.map((dest, i) => (
            <div key={i} className="flex items-center gap-4 text-sm">
              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                {dest.destinationId}
              </span>
              <span className="text-gray-500">
                Requires approval: {dest.requireApproval === true ? 'yes' : 'no'}
              </span>
              {Object.keys(dest.settings).length > 0 && (
                <pre className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                  {JSON.stringify(dest.settings)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Steps</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="py-2 pr-6 font-medium">#</th>
              <th className="py-2 pr-6 font-medium">Step</th>
              <th className="py-2 pr-6 font-medium">Description</th>
              <th className="py-2 pr-6 font-medium">Model</th>
              <th className="py-2 pr-6 font-medium">Prompt</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {stepsWithPrompts.map((step: WorkflowStepMeta & { sharedPrompt: { id: string; version: number } | null }, i: number) => (
              <tr key={step.stepName} className="border-b border-gray-50">
                <td className="py-3 pr-6 text-gray-400 text-xs">{i + 1}</td>
                <td className="py-3 pr-6 font-mono text-xs text-gray-900">{step.stepName}</td>
                <td className="py-3 pr-6 text-gray-600">{step.stepDescription}</td>
                <td className="py-3 pr-6 font-mono text-xs text-gray-500">{step.model}</td>
                <td className="py-3 pr-6">
                  {!step.requiresPrompt ? (
                    <span className="text-xs text-gray-400">none</span>
                  ) : step.sharedPrompt ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      shared v{step.sharedPrompt.version}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                      missing
                    </span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {step.sharedPrompt && (
                    <Link
                      href={`/admin/prompts/${step.sharedPrompt.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Edit →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stepsWithPrompts.some((s: WorkflowStepMeta) => s.usesTools && s.usesTools.length > 0) && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            {stepsWithPrompts
              .filter((s: WorkflowStepMeta) => s.usesTools && s.usesTools.length > 0)
              .map((s: WorkflowStepMeta) => (
                <p key={s.stepName} className="text-xs text-gray-500">
                  <span className="font-mono">{s.stepName}</span> uses tools:{' '}
                  {s.usesTools!.join(', ')}
                </p>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
