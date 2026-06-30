'use server';

import { db, gmailOperationErrors } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function resolveError(formData: FormData): Promise<void> {
  const errorId = formData.get('errorId') as string;
  await db
    .update(gmailOperationErrors)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(gmailOperationErrors.id, errorId));
  revalidatePath('/admin/gmail-errors');
  revalidatePath('/admin');
}
