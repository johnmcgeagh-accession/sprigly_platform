'use server';

import { db } from '@sprigly/db';
import { switchPollingMode } from '@sprigly/sources';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function changeMailboxMode(formData: FormData): Promise<void> {
  const connectionId = formData.get('connectionId') as string;
  const targetMode   = formData.get('targetMode')   as 'selective' | 'full';

  // switchPollingMode is the single atomic operation keyed on connection id:
  //   updates polling_mode, resets last_polled_at, ensures/disables the
  //   match-all fallback rule. Do NOT touch those columns or routing_rules directly.
  await switchPollingMode(db, connectionId, targetMode);

  revalidatePath('/admin/mailboxes');
  revalidatePath(`/admin/mailboxes/${connectionId}`);
  redirect('/admin/mailboxes');
}
