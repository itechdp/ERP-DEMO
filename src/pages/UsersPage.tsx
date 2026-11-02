import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, Pencil, RefreshCw, UserPlus, Users } from 'lucide-react';
import { ROLES, useAccess, type Role } from '../auth/access';
import { createUser, generatePassword, listUsers, resetPassword, updateUser, type AppUser } from '../auth/userAdmin';
import { Empty, Field, Modal, PageHeader, Search } from '../components/ui';
import { RoleTag } from '../components/PersonSelect';
import { fmtDateTime } from '../components/format';
import { useStore } from '../store/StoreContext';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Settings → Users: add people and set their name, role, status and password. Director / Plant Head only. */
export function UsersPage() {
  const { toast } = useStore();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);
  const [pwFor, setPwFor] = useState<AppUser | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return users.filter((u) => !ql || [u.name, u.email, u.role].some((v) => v.toLowerCase().includes(ql)));
  }, [users, q]);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Users"
        subtitle="The people who can sign in. Their role decides what they see; fine-tune it in Access Control."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <UserPlus size={15} /> Add User
          </button>
        }
      />
      <div className="card">
        <div className="card-head" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Search value={q} onChange={setQ} placeholder="Search name, e-mail or role…" />
          <span className="text-xs muted" style={{ marginLeft: 'auto' }}>{users.filter((u) => u.active).length} active · {users.length} in all</span>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading users…</div>
        ) : error ? (
          <Empty icon={Users} title="Could not load the users" text={error} />
        ) : shown.length === 0 ? (
          <Empty icon={Users} title="No users found" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-mail</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} style={u.active ? undefined : { opacity: 0.6 }}>
                    <td className="strong">
                      {u.name} {u.isMe && <span className="text-xs muted">(you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td><RoleTag role={u.role} /></td>
                    <td>{u.active ? <span className="badge b-green">Active</span> : <span className="badge b-neutral">Switched off</span>}</td>
                    <td className="nowrap">{u.lastSignIn ? fmtDateTime(u.lastSignIn) : 'Never'}</td>
                    <td className="r nowrap">
                      <div className="icon-actions">
                        <button className="icon-btn" title="Edit" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil size={17} /></button>
                        <button className="icon-btn" title="Set a new password" aria-label={`New password for ${u.name}`} onClick={() => setPwFor(u)}><KeyRound size={17} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserModal
          user={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            toast({ kind: 'success', title: msg });
            setEditing(null);
            void reload();
          }}
        />
      )}
      {pwFor && (
        <PasswordModal
          user={pwFor}
          onClose={() => setPwFor(null)}
          onSaved={() => {
            toast({ kind: 'success', title: 'Password changed', message: pwFor.name });
            setPwFor(null);
          }}
        />
      )}
    </>
  );
}

/** the roles this person may hand out: only the Director can make a Director or Plant Head */
function useAssignableRoles() {
  const { role } = useAccess();
  return ROLES.filter((r) => role === 'director' || (r.value !== 'director' && r.value !== 'plant_head'));
}

function PasswordField({ value, onChange, label = 'Password' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [show, setShow] = useState(true);
  const { toast } = useStore();
  return (
    <Field label={label} required hint="At least 8 characters. Tell the person their password — they can use it to sign in straight away.">
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" style={{ flex: 1 }} />
        <button type="button" className="btn btn-subtle" title={show ? 'Hide' : 'Show'} onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        <button type="button" className="btn btn-subtle" title="Make a random password" onClick={() => { onChange(generatePassword()); setShow(true); }}><RefreshCw size={15} /></button>
        <button type="button" className="btn btn-subtle" title="Copy" disabled={!value} onClick={() => void navigator.clipboard?.writeText(value).then(() => toast({ kind: 'info', title: 'Password copied' }))}><Copy size={15} /></button>
      </div>
    </Field>
  );
}

function UserModal({ user, onClose, onSaved }: { user?: AppUser; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useStore();
  const roles = useAssignableRoles();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'viewer');
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState(() => (user ? '' : generatePassword()));
  const [busy, setBusy] = useState(false);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const valid = name.trim() !== '' && (user ? true : emailOk && password.length >= 8);
  // a role the person may not hand out (e.g. an existing Director seen by a Plant Head) is shown but locked
  const locked = !!user && !roles.some((r) => r.value === user.role);

  const submit = async () => {
    setBusy(true);
    try {
      if (user) {
        await updateUser(user.id, { name: name.trim(), role, active });
        onSaved('User updated');
      } else {
        await createUser({ email: email.trim(), password, name: name.trim(), role });
        onSaved('User added');
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the user', message: errText(e) });
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={UserPlus}
      title={user ? 'Edit User' : 'Add User'}
      subtitle={user ? user.email : 'Creates a login. The person signs in with this e-mail and password.'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy || locked} onClick={() => void submit()}>
            {busy ? 'Saving…' : user ? 'Save Changes' : 'Add User'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required hint="Shown everywhere, and in the Assigned-to list. Must be different for every user.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rakesh Patel" autoFocus />
        </Field>
        <Field label="E-mail (sign-in)" required error={email && !emailOk ? 'Enter a valid e-mail address' : null}>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!user} placeholder="name@company.com" autoComplete="off" />
        </Field>
        <Field label="Role" required hint={ROLES.find((r) => r.value === role)?.hint === 'Full access' ? 'Full access to everything' : 'What they can see and do follows this role (Settings → Access Control)'}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={locked || user?.isMe}>
            {(locked && user ? ROLES.filter((r) => r.value === user.role) : roles).map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        {user ? (
          <Field label="Status" hint={user.isMe ? 'You cannot switch yourself off' : 'A switched-off person cannot sign in or be given tasks; their history stays'}>
            <select value={active ? 'on' : 'off'} onChange={(e) => setActive(e.target.value === 'on')} disabled={locked || user.isMe}>
              <option value="on">Active</option>
              <option value="off">Switched off</option>
            </select>
          </Field>
        ) : (
          <PasswordField value={password} onChange={setPassword} />
        )}
      </div>
      {locked && <div className="callout warn" style={{ marginTop: 12 }}>Only the Director can change a Director or Plant Head account.</div>}
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSaved }: { user: AppUser; onClose: () => void; onSaved: () => void }) {
  const { toast } = useStore();
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await resetPassword(user.id, password);
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the password', message: errText(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      icon={KeyRound}
      title="Set a New Password"
      subtitle={`${user.name} · ${user.email}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || password.length < 8} onClick={() => void submit()}>{busy ? 'Saving…' : 'Set Password'}</button>
        </>
      }
    >
      <PasswordField label="New password" value={password} onChange={setPassword} />
    </Modal>
  );
}
