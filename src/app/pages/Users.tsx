/**
 * Users.tsx — Admin screen to manage application users (Supabase Auth users).
 *
 * Roles are authoritative on the auth user's app_metadata.role (mirrored to
 * user_metadata.role for legacy reads). New Google sign-ins default to "sqm";
 * admins promote/demote here. All writes go through admin-gated edge routes
 * (service-role Auth Admin API):
 *   GET    /users               → all auth users + role
 *   PUT    /users/role {userId, role}
 *   DELETE /users      {userId}
 *
 * Admin-only (route is wrapped in <AdminOnly>). An admin cannot demote or
 * delete their own account (enforced both here and on the server).
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Users as UsersIcon, Trash2, ShieldCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../../../utils/supabase/info';
import { getAuthHeaders } from '../lib/authHeaders';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

type Role = 'admin' | 'sqm' | 'ops';

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  provider: string;
  created_at: string;
  last_sign_in_at: string | null;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'sqm', label: 'SQM' },
  { value: 'ops', label: 'Ops (Driver / QC)' },
];

const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-blue-100 text-blue-800',
  sqm: 'bg-emerald-100 text-emerald-800',
  ops: 'bg-amber-100 text-amber-800',
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/users`, { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const changeRole = async (u: AppUser, role: Role) => {
    if (role === u.role) return;
    if (u.id === user?.id && role !== 'admin') {
      toast.error('You cannot remove admin access from your own account.');
      return;
    }
    setBusyId(u.id);
    try {
      const res = await fetch(`${baseUrl}/users/role`, {
        method: 'PUT',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
      toast.success(`${u.email} is now ${role.toUpperCase()}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const u = deleteTarget;
    setBusyId(u.id);
    try {
      const res = await fetch(`${baseUrl}/users`, {
        method: 'DELETE',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success(`Removed ${u.email}`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-6 w-6 text-gray-700" />
          <h1 className="text-2xl font-semibold">Users</h1>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Manage who can access the platform and what role they have. New users who sign
        in with Google start as <span className="font-medium">SQM</span> by default —
        promote them to <span className="font-medium">Admin</span> here. Admins have full
        access including this page.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            All users {!loading && <span className="text-gray-400 font-normal">({users.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-10 text-center text-gray-400">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">Sign-in</th>
                    <th className="py-2 pr-4 font-medium">Created</th>
                    <th className="py-2 pr-4 font-medium">Last login</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === user?.id;
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-gray-900">
                            {u.name || u.email}
                            {isSelf && (
                              <span className="ml-2 text-xs text-gray-400">(you)</span>
                            )}
                          </div>
                          {u.name && (
                            <div className="text-xs text-gray-500">{u.email}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4 capitalize text-gray-600">{u.provider}</td>
                        <td className="py-3 pr-4 text-gray-600">{fmtDate(u.created_at)}</td>
                        <td className="py-3 pr-4 text-gray-600">{fmtDate(u.last_sign_in_at)}</td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role]}`}
                          >
                            {u.role === 'admin' && <ShieldCheck className="h-3 w-3" />}
                            {u.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 pr-2">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              className="border rounded-md px-2 py-1 text-sm bg-white disabled:opacity-50"
                              value={u.role}
                              disabled={busyId === u.id || (isSelf)}
                              title={isSelf ? 'You cannot change your own role' : 'Change role'}
                              onChange={(e) => changeRole(u, e.target.value as Role)}
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === u.id || isSelf}
                              title={isSelf ? 'You cannot delete your own account' : 'Remove user'}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove user?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            This permanently removes{' '}
            <span className="font-medium">{deleteTarget?.email}</span> from the platform.
            They will lose all access immediately. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={busyId === deleteTarget?.id}
              onClick={confirmDelete}
            >
              Remove user
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
