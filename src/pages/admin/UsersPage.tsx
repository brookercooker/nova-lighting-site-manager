import { useEffect, useRef, useState } from "react";
import { useManagerTitle } from "./useManagerTitle";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/prototype/client";
import { callAdminUsers } from "./adminUsers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Shield, User as UserIcon, ArrowLeft, UserPlus, MoreHorizontal, Pencil, Trash2, KeyRound } from "lucide-react";
import { REQUIRE_LOGIN } from "@/lib/authGate";
import "./usersLayout.css";



interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  is_user: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const loadedRef = useRef(false);
  useManagerTitle("Users");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data, error }) => {
      if (error || !data.user) {
        if (REQUIRE_LOGIN) await supabase.auth.signOut();
        setCurrentUserId(null);
        setIsAdmin(false);
        return;
      }
      setCurrentUserId(data.user.id);
      const { data: roleData } = await (supabase as any).rpc("has_role", {
        _user_id: data.user.id, _role: "admin",
      });
      setIsAdmin(!!roleData);
    });
  }, []);


  const load = async () => {
    setLoading(true);
    try {
      const data = await callAdminUsers();
      setUsers(data.users ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [isAdmin]);

  const setAdmin = async (u: AdminUser, next: boolean) => {
    setBusyId(u.id);
    try {
      await callAdminUsers({ action: "set_admin", user_id: u.id, is_admin: next });
      toast.success(next ? `${u.email} is now an Admin` : `${u.email} is now a User`);
      setUsers((cur) => cur.map((x) => (x.id === u.id ? { ...x, is_admin: next, is_user: true } : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const setAccess = async (u: AdminUser, next: boolean) => {
    setBusyId(u.id);
    try {
      await callAdminUsers({ action: "set_user", user_id: u.id, is_user: next });
      toast.success(next ? `${u.email} now has access` : `${u.email} no longer has access`);
      setUsers((cur) => cur.map((x) => (x.id === u.id ? { ...x, is_user: next, is_admin: next ? x.is_admin : false } : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<"user" | "admin">("user");
  const [inviting, setInviting] = useState(false);

  const sendInvite = async () => {
    setInviting(true);
    try {
      await callAdminUsers({
        action: "create_user",
        email: inviteEmail,
        password: invitePassword,
        role: inviteRole,
      });
      toast.success(`Created ${inviteEmail}`);
      setInviteEmail("");
      setInvitePassword("");
      setInviteRole("user");
      setInviteOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setInviting(false);
    }
  };

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const openEdit = (u: AdminUser) => {
    setEditUser(u);
    setEditRole(u.is_admin ? "admin" : "user");
  };
  const saveEdit = async () => {
    if (!editUser) return;
    const next = editRole === "admin";
    if (next === editUser.is_admin) { setEditUser(null); return; }
    await setAdmin(editUser, next);
    setEditUser(null);
  };

  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      await callAdminUsers({ action: "delete_user", user_id: deleteUser.id });
      toast.success(`Deleted ${deleteUser.email}`);
      setUsers((cur) => cur.filter((x) => x.id !== deleteUser.id));
      setDeleteUser(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const savePassword = async () => {
    if (!pwUser) return;
    setPwSaving(true);
    try {
      await callAdminUsers({ action: "set_password", user_id: pwUser.id, password: pwValue });
      toast.success(`Password updated for ${pwUser.email}`);
      setPwUser(null);
      setPwValue("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setPwSaving(false);
    }
  };


  if (isAdmin === null) {
    return <div className="min-h-screen" aria-hidden="true" />;
  }
  if (isAdmin === false) {
    if (REQUIRE_LOGIN) return <Navigate to="/admin" replace />;
    return <div className="min-h-screen bg-background p-6"><Button asChild variant="ghost"><Link to="/manage/pages"><ArrowLeft className="h-4 w-4" />Site Manager</Link></Button><h1 className="mt-4 text-base font-medium">User Management</h1><p className="mt-3 text-sm text-muted-foreground">Sign in to load or save this. User Management requires an authorized account.</p></div>;
  }

  return (
    <div className="nova-users-page min-h-screen bg-background">
      <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="w-full px-6 py-3 flex items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/admin"><ArrowLeft className="w-4 h-4" /> Site Manager</Link>
          </Button>
          <h1 className="text-base font-medium tracking-tight">User Management</h1>
        </div>
      </header>

      <main className="w-full px-6 py-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-end gap-4 mb-4">

          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 shrink-0">
                <UserPlus className="w-4 h-4" /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a New User</DialogTitle>
                <DialogDescription>
                  Create a user with an email and password. Share the password with them directly.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="name@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password">Password</Label>
                  <Input
                    id="invite-password"
                    type="text"
                    placeholder="At least 8 characters"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "user" | "admin")}>
                    <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>Cancel</Button>
                <Button onClick={sendInvite} disabled={inviting || !inviteEmail || invitePassword.length < 8}>
                  {inviting ? "Creating…" : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>


        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading users…</div>
        ) : (
          <div className="nova-users-list border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-3 px-4 text-left">Email</th>
                  <th className="py-3 px-4 text-left min-w-[220px]">Roles</th>
                  <th className="py-3 px-4 text-left">Last Sign-In</th>
                  <th className="py-3 px-4 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t align-middle">
                    <td className="py-3 px-4">
                      <div className="font-medium truncate">{u.email || <span className="text-muted-foreground italic">no email</span>}</div>
                      <div className="nova-user-id text-[10px] text-muted-foreground font-mono truncate">{u.id}</div>
                    </td>
                    <td className="py-3 px-4 min-w-[220px]">
                      <div className="flex flex-wrap gap-1.5">
                        {u.is_admin && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                            <Shield className="w-3 h-3" /> Admin
                          </span>
                        )}
                        {u.is_user && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            <UserIcon className="w-3 h-3" /> User
                          </span>
                        )}
                        {!u.is_admin && !u.is_user && (
                          <>
                            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded border text-muted-foreground">No Access</span>
                            {u.id !== currentUserId && (
                              <Button size="sm" variant="outline" className="nova-user-access h-6 px-2 text-xs" disabled={busyId === u.id} onClick={() => setAccess(u, true)}>
                                Give Access
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                      <span className="sm:hidden">Last sign-in: </span>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-4 text-left">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="nova-user-actions" disabled={busyId === u.id} aria-label="User Actions">
                            <MoreHorizontal className="w-4 h-4" /><span className="sm:hidden">User Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(u.id).then(() => toast.success("ID copied"), () => toast.error("Copy failed")); }}>Copy ID</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(u)}>
                            <Pencil className="w-4 h-4 mr-2" /> Edit Role
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { setPwUser(u); setPwValue(""); }}>
                            <KeyRound className="w-4 h-4 mr-2" /> Set Password
                          </DropdownMenuItem>
                          {(u.is_user || u.is_admin) && u.id !== currentUserId && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setAccess(u, false)}>
                                <UserIcon className="w-4 h-4 mr-2" /> Remove Access
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={u.id === currentUserId}
                            onClick={() => setDeleteUser(u)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>

                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={editRole} onValueChange={(v) => setEditRole(v as "user" | "admin")}>
              <SelectTrigger id="edit-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {editUser?.id === currentUserId && editRole === "user" && (
              <p className="text-xs text-destructive">You cannot remove your own admin role.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              onClick={saveEdit}
              disabled={busyId === editUser?.id || (editUser?.id === currentUserId && editRole === "user")}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwUser} onOpenChange={(o) => { if (!o) { setPwUser(null); setPwValue(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
            <DialogDescription>{pwUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="pw-value">New Password</Label>
            <Input
              id="pw-value"
              type="text"
              placeholder="At least 8 characters"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPwUser(null)} disabled={pwSaving}>Cancel</Button>
            <Button onClick={savePassword} disabled={pwSaving || pwValue.length < 8}>
              {pwSaving ? "Saving…" : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUser?.email} will permanently lose access. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

}
