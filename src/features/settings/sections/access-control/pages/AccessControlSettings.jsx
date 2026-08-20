import { KeyRound, Search, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/core/ui/badge';
import { EmptyState } from '@/core/ui/empty-state';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { useGroupSummaries, useUsers } from '../hooks/useAccessControl';
import { memberName, roleLabel } from '../utils/accessControl';
import { UserAccessDrawer } from '../components/UserAccessDrawer';
import { GroupList } from '../components/GroupList';
import { GroupPermissionEditor } from '../components/GroupPermissionEditor';
import { PermissionCatalog } from '../components/PermissionCatalog';
import { GroupFormDrawer } from '../components/GroupFormDrawer';

export function AccessControlSettings() {
  const { tenant, tenantUser } = useWorkspace();
  const owner = tenantUser?.role === 'owner';
  const [tab, setTab] = useState('users');
  const users = useUsers(tenant?.id, owner && tab === 'users');
  const groups = useGroupSummaries(tenant?.id, owner && tab === 'groups');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    return users.items.filter((user) => !query || [user.fullName, user.email, user.phone].some((value) => value?.toLowerCase().includes(query)));
  }, [users.items, term]);

  if (!owner) return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">صفحة الأدوار والصلاحيات متاحة لمالك الشركة فقط.</div>;

  return <div className="space-y-5" dir="rtl">
    <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
      <button className={`flex-1 rounded-lg px-4 py-2 text-sm font-black ${tab === 'users' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setTab('users')}><Users className="ml-2 inline h-4 w-4"/>المستخدمون</button>
      <button className={`flex-1 rounded-lg px-4 py-2 text-sm font-black ${tab === 'groups' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setTab('groups')}><ShieldCheck className="ml-2 inline h-4 w-4"/>الأدوار / المجموعات</button>
      <button className={`flex-1 rounded-lg px-4 py-2 text-sm font-black ${tab === 'permissions' ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => setTab('permissions')}><KeyRound className="ml-2 inline h-4 w-4"/>الصلاحيات</button>
    </div>
    {tab === 'permissions' ? <PermissionCatalog active/> : tab === 'groups' ? <GroupList groups={groups} onSelect={setSelectedGroup} onCreate={()=>setCreatingGroup(true)}/> : <>
      <div className="relative"><Search className="absolute right-4 top-3.5 h-4 w-4 text-slate-400"/><Input className="pr-11" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="بحث بالاسم أو البريد أو الهاتف..."/></div>
      {users.status === 'loading' ? <LoadingSpinner title="جاري تحميل المستخدمين"/> : null}
      {users.error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{users.error}</div> : null}
      {users.status === 'ready' && filtered.length === 0 ? <EmptyState icon={Users} title="لا يوجد مستخدمون" description="لم يتم العثور على مستخدمين مطابقين." surface="plain"/> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((user) => <button key={user.id} className="rounded-xl border border-slate-200 bg-white p-4 text-right shadow-sm transition hover:border-slate-400 hover:shadow-md" onClick={() => setSelected(user)}><div className="flex items-start justify-between gap-2"><div><h3 className="font-black text-slate-900">{memberName(user)}</h3><p className="mt-1 text-xs text-slate-500">{user.email || user.phone || 'لا توجد بيانات اتصال'}</p></div><Badge variant={user.isActive ? 'success' : 'warning'}>{user.isActive ? 'نشط' : 'غير نشط'}</Badge></div><div className="mt-4 flex flex-wrap gap-2"><Badge>{roleLabel(user.role)}</Badge><Badge>{user.groupCount} مجموعة</Badge>{user.defaultBranchName ? <Badge variant="accent">{user.defaultBranchName}</Badge> : null}</div></button>)}</div>
    </>}
    <UserAccessDrawer tenantId={tenant?.id} user={selected} onClose={() => setSelected(null)} onChanged={users.reload}/>
    <GroupPermissionEditor tenantId={tenant?.id} group={selectedGroup} onClose={() => setSelectedGroup(null)} onSaved={groups.reload}/>
    <GroupFormDrawer open={creatingGroup} onClose={()=>setCreatingGroup(false)} onCreated={groups.reload}/>
  </div>;
}
