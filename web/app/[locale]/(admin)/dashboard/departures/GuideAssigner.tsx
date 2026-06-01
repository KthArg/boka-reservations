'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { assignGuide, unassignGuide } from '@/lib/guides/assign-action';
import type { AssignableGuide } from '@/lib/guides/types';
import styles from './departures.module.css';

type Props = {
  instanceId: string;
  guides: AssignableGuide[];
  assignedGuideId: string | null;
};

export function GuideAssigner({ instanceId, guides, assignedGuideId }: Props) {
  const t = useTranslations('guides');
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(assignedGuideId ?? '');

  function onAssign() {
    if (!selected) return;
    startTransition(async () => {
      const result = await assignGuide(instanceId, selected);
      if (!result.ok) window.alert(t('assign-error'));
    });
  }

  function onUnassign() {
    if (!window.confirm(t('unassign-confirm'))) return;
    startTransition(async () => {
      const result = await unassignGuide(instanceId);
      if (!result.ok) window.alert(t('assign-error'));
      else setSelected('');
    });
  }

  return (
    <div className={styles.assigner}>
      <select
        className={styles.select}
        value={selected}
        disabled={pending}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">{t('select-guide')}</option>
        {guides.map((g) => (
          <option key={g.id} value={g.id}>
            {g.fullName}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.assignBtn}
        onClick={onAssign}
        disabled={pending || !selected || selected === assignedGuideId}
      >
        {t('assign')}
      </button>
      {assignedGuideId ? (
        <button
          type="button"
          className={styles.unassignBtn}
          onClick={onUnassign}
          disabled={pending}
        >
          {t('unassign')}
        </button>
      ) : null}
    </div>
  );
}
