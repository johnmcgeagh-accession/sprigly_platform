import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, promptTemplates, clients } from '@sprigly/db';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { saveNewVersion } from '../actions';

async function getTemplate(id: string) {
  const rows = await db
    .select({
      id: promptTemplates.id,
      clientId: promptTemplates.clientId,
      workflowId: promptTemplates.workflowId,
      stepName: promptTemplates.stepName,
      promptText: promptTemplates.promptText,
      version: promptTemplates.version,
      createdAt: promptTemplates.createdAt,
      clientName: clients.name,
    })
    .from(promptTemplates)
    .leftJoin(clients, eq(promptTemplates.clientId, clients.id))
    .where(eq(promptTemplates.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getVersionHistory(template: {
  clientId: string | null;
  workflowId: string;
  stepName: string;
}) {
  const clientCondition = template.clientId
    ? eq(promptTemplates.clientId, template.clientId)
    : isNull(promptTemplates.clientId);

  return db
    .select({
      id: promptTemplates.id,
      version: promptTemplates.version,
      createdAt: promptTemplates.createdAt,
    })
    .from(promptTemplates)
    .where(
      and(
        clientCondition,
        eq(promptTemplates.workflowId, template.workflowId),
        eq(promptTemplates.stepName, template.stepName),
      ),
    )
    .orderBy(desc(promptTemplates.version));
}

export default async function PromptDetailPage({ params }: { params: { id: string } }) {
  const template = await getTemplate(params.id);
  if (!template) notFound();

  const versions = await getVersionHistory(template);
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/prompts" className="text-sm text-gray-500 hover:text-gray-700">
          ← Prompt Templates
        </Link>
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                <span className="font-mono">{template.workflowId}</span>
                <span className="text-gray-400 mx-2">/</span>
                <span className="font-mono">{template.stepName}</span>
              </h1>
              <span className="inline-flex items-center px-2.5 py-1 rounded text-sm font-medium bg-blue-100 text-blue-700">
                v{template.version}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Client: {template.clientName ?? 'global'} · Created:{' '}
              {template.createdAt.toLocaleString('en-GB')}
            </p>
          </div>

          {/* Current prompt text */}
          <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Current prompt text</h2>
            <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-4 overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
              {template.promptText}
            </pre>
          </div>

          {/* Edit section */}
          <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Edit prompt</h2>
            <p className="text-xs text-gray-400 mb-4">
              Saving creates v{nextVersion}. Existing versions are never modified.
            </p>
            <form action={saveNewVersion} className="space-y-4">
              <input type="hidden" name="templateId" value={template.id} />
              <textarea
                name="promptText"
                rows={18}
                defaultValue={template.promptText}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gray-400 leading-relaxed"
              />
              <button
                type="submit"
                className="px-5 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
              >
                Save as v{nextVersion}
              </button>
            </form>
          </div>
        </div>

        {/* Version sidebar */}
        <div className="w-52 flex-shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-5 sticky top-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Version history</h2>
            <ul className="space-y-1">
              {versions.map((v) => {
                const isCurrent = v.id === template.id;
                return (
                  <li key={v.id}>
                    <Link
                      href={`/admin/prompts/${v.id}`}
                      className={`flex items-center justify-between px-2 py-1.5 rounded text-sm ${
                        isCurrent
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span>v{v.version}</span>
                      <span className="text-xs text-gray-400">
                        {v.createdAt.toLocaleDateString('en-GB')}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
