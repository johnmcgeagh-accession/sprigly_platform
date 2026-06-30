import { db as _db, promptTemplates } from '@sprigly/db';
import { eq, and, desc, isNull } from 'drizzle-orm';

type Db = typeof _db;

export class DbPromptResolver {
  constructor(private db: Db) {}

  async resolve(clientId: string, workflowId: string, stepName: string): Promise<string> {
    const clientRows = await this.db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.clientId, clientId),
          eq(promptTemplates.workflowId, workflowId),
          eq(promptTemplates.stepName, stepName),
        ),
      )
      .orderBy(desc(promptTemplates.version))
      .limit(1);

    if (clientRows[0] !== undefined) {
      return clientRows[0].promptText;
    }

    const globalRows = await this.db
      .select()
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

    if (globalRows[0] !== undefined) {
      return globalRows[0].promptText;
    }

    throw new Error(
      `No prompt template found for workflow=${workflowId} step=${stepName} (clientId=${clientId})`,
    );
  }
}
