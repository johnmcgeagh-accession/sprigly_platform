'use server';

import { db, approvals } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function approveRun(formData: FormData): Promise<void> {
  const approvalId = formData.get('approvalId') as string;
  await db
    .update(approvals)
    .set({ status: 'approved', decidedAt: new Date() })
    .where(eq(approvals.id, approvalId));
  revalidatePath('/admin/approvals');
}

export async function rejectRun(formData: FormData): Promise<void> {
  const approvalId = formData.get('approvalId') as string;
  await db
    .update(approvals)
    .set({ status: 'rejected', decidedAt: new Date() })
    .where(eq(approvals.id, approvalId));
  revalidatePath('/admin/approvals');
}
