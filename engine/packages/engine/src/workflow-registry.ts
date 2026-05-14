import type { Workflow } from './types.js';

export class WorkflowRegistry {
  private workflows = new Map<string, Workflow>();

  register(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  get(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  getAll(): Workflow[] {
    return [...this.workflows.values()];
  }
}
