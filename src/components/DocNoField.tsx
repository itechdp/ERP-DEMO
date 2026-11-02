import { useEffect, useState } from 'react';
import { supabase } from '../db/client';
import { Field } from './ui';

/**
 * The number of a new document: filled in with the next automatic number, free to be changed.
 * `custom` is what to send with the save — only a number the user typed; while it is unchanged the database numbers it itself,
 * so two people adding at once never collide. A number that is already used is refused by the database on save.
 */
export function useDocNo(docKey: string, enabled = true) {
  const [no, setNo] = useState('');
  const [auto, setAuto] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let off = false;
    void supabase.rpc('peek_doc_no', { p_key: docKey }).then(({ data, error }) => {
      if (off || error || !data) return;
      setAuto(String(data));
      setNo((cur) => cur || String(data));
    });
    return () => {
      off = true;
    };
  }, [docKey, enabled]);
  const typed = no.trim();
  return { no, setNo, custom: typed && typed !== auto ? typed : undefined };
}

export function DocNoField({ label = 'Number', no, setNo, full }: { label?: string; no: string; setNo: (v: string) => void; full?: boolean }) {
  return (
    <Field label={label} full={full} hint="Numbered automatically — you can change it. A number already in use is not accepted.">
      <input className="input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="Automatic" maxLength={40} />
    </Field>
  );
}
