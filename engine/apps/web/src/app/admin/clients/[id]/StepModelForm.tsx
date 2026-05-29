'use client';

import { updateStepModel } from './actions';

interface Props {
  clientId: string;
  workflowId: string;
  stepName: string;
  currentModel: string;
  isOverridden: boolean;
}

export function StepModelForm({ clientId, workflowId, stepName, currentModel, isOverridden }: Props) {
  return (
    <form action={updateStepModel} className="inline-flex items-center gap-1">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="workflowId" value={workflowId} />
      <input type="hidden" name="stepName" value={stepName} />
      <select
        name="model"
        defaultValue={currentModel}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={(e) => (e.target as any).form?.requestSubmit()}
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="haiku">haiku</option>
        <option value="sonnet">sonnet</option>
      </select>
      {isOverridden && (
        <span className="text-xs text-blue-600 font-medium">overridden</span>
      )}
    </form>
  );
}
