import { ShieldCheck, Users2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/core/ui/badge';
import { EmptyState } from '@/core/ui/empty-state';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { permissionsService } from '@/features/settings/sections/permissions/permissions.service';

function roleLabel(role) {
  const labels = {
    owner: 'مالك',
    admin: 'مدير',
    cashier: 'كاشير',
    sales: 'مبيعات',
    accountant: 'محاسب',
    staff: 'موظف',
  };

  return labels[role] ?? role ?? 'موظف';
}

function getMemberName(member) {
  return member.fullName || member.email || member.phone || 'مستخدم بدون اسم';
}

export function PermissionsSettings() {
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const isOwner = tenantUser?.role === 'owner';
  const [groups, setGroups] = useState([]);
  const [groupsStatus, setGroupsStatus] = useState('idle');
  const [groupsError, setGroupsError] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (!tenantId || !isOwner) {
      setGroups([]);
      setGroupsStatus('idle');
      setGroupsError('');
      return undefined;
    }

    setGroupsStatus('loading');
    setGroupsError('');

    permissionsService
      .listGroupsWithModules(tenantId)
      .then((items) => {
        if (!mounted) return;
        setGroups(items);
        setGroupsStatus('ready');
      })
      .catch((error) => {
        if (!mounted) return;
        setGroups([]);
        setGroupsStatus('error');
        setGroupsError(error.message || 'تعذر تحميل الجروبات.');
      });

    return () => {
      mounted = false;
    };
  }, [isOwner, tenantId]);

  if (!isOwner) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        صفحة الأدوار والصلاحيات متاحة لمالك الشركة فقط.
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">الجروبات</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            اختر جروب لإدارة الموظفين المرتبطين به داخل مساحة العمل الحالية.
          </p>
        </div>
        <Badge variant="accent">{groups.length} جروب</Badge>
      </div>

      {groupsStatus === 'loading' ? <LoadingSpinner title="جاري تحميل الجروبات" /> : null}

      {groupsStatus === 'error' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {groupsError}
        </div>
      ) : null}

      {groupsStatus === 'ready' && groups.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="لا توجد جروبات"
          description="لم يتم العثور على جروبات داخل مساحة العمل الحالية."
          surface="plain"
        />
      ) : null}

      {groups.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedGroup(group)}
              className="flex min-h-36 flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-100"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-base font-black text-slate-950">{group.name}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">{group.code}</div>
                  </div>
                  {group.isSystem ? <Badge>نظام</Badge> : null}
                </div>
                <p className="line-clamp-2 text-sm font-medium leading-6 text-slate-500">
                  {group.description || 'لا يوجد وصف لهذا الجروب.'}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="success">{group.module?.name || 'بدون تطبيق'}</Badge>
                {group.category ? <Badge>{group.category}</Badge> : null}
                {group.active === false ? <Badge variant="warning">غير نشط</Badge> : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <GroupMembersDrawer
        tenantId={tenantId}
        group={selectedGroup}
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedGroup(null);
          }
        }}
      />
    </div>
  );
}

function GroupMembersDrawer({ tenantId, group, open, onOpenChange }) {
  const [members, setMembers] = useState([]);
  const [membershipByUserId, setMembershipByUserId] = useState(new Map());
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [updatingUserIds, setUpdatingUserIds] = useState(() => new Set());

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !group?.id) {
      setMembers([]);
      setMembershipByUserId(new Map());
      setStatus('idle');
      setError('');
      setUpdatingUserIds(new Set());
      return undefined;
    }

    setStatus('loading');
    setError('');

    Promise.all([
      permissionsService.listTenantUsers(tenantId),
      permissionsService.listGroupMemberships({ tenantId, groupId: group.id }),
    ])
      .then(([nextMembers, memberships]) => {
        if (!mounted) return;
        setMembers(nextMembers);
        setMembershipByUserId(new Map(memberships.map((membership) => [membership.userId, membership])));
        setStatus('ready');
      })
      .catch((nextError) => {
        if (!mounted) return;
        setMembers([]);
        setMembershipByUserId(new Map());
        setStatus('error');
        setError(nextError.message || 'تعذر تحميل موظفي الجروب.');
      });

    return () => {
      mounted = false;
    };
  }, [group?.id, open, tenantId]);

  const setUserUpdating = (userId, isUpdating) => {
    setUpdatingUserIds((current) => {
      const next = new Set(current);

      if (isUpdating) {
        next.add(userId);
      } else {
        next.delete(userId);
      }

      return next;
    });
  };

  const handleToggle = async (member, checked) => {
    if (!tenantId || !group?.id || !member?.id || member.role === 'owner') {
      return;
    }

    const currentMembership = membershipByUserId.get(member.id);

    if ((checked && currentMembership) || (!checked && !currentMembership)) {
      return;
    }

    setUserUpdating(member.id, true);
    setError('');

    try {
      if (checked) {
        const membership = await permissionsService.addUserToGroup({
          tenantId,
          userId: member.id,
          groupId: group.id,
        });
        setMembershipByUserId((current) => new Map(current).set(member.id, membership));
      } else {
        await permissionsService.removeUserFromGroup({
          tenantId,
          userId: member.id,
          groupId: group.id,
        });
        setMembershipByUserId((current) => {
          const next = new Map(current);
          next.delete(member.id);
          return next;
        });
      }
    } catch (nextError) {
      setError(nextError.message || 'تعذر تحديث صلاحيات الموظف.');
    } finally {
      setUserUpdating(member.id, false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-full sm:max-w-2xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-14">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
              <Users2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle>{group?.name || 'الجروب'}</SheetTitle>
              <SheetDescription>
                {group?.module?.name ? `تطبيق ${group.module.name}` : 'إدارة أعضاء الجروب داخل مساحة العمل.'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
            المالك لديه كل الصلاحيات تلقائيًا ولا يمكن تعديل صلاحياته من هنا.
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {status === 'loading' ? <LoadingSpinner title="جاري تحميل الموظفين" /> : null}

          {status === 'ready' && members.length === 0 ? (
            <EmptyState
              icon={Users2}
              title="لا يوجد موظفون"
              description="لم يتم العثور على موظفين داخل مساحة العمل الحالية."
              surface="plain"
            />
          ) : null}

          {status === 'ready' && members.length ? (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {members.map((member) => {
                const isMemberOwner = member.role === 'owner';
                const isChecked = isMemberOwner || membershipByUserId.has(member.id);
                const isUpdating = updatingUserIds.has(member.id);
                const labelId = `group-${group?.id}-user-${member.id}`;

                return (
                  <label
                    key={member.id}
                    htmlFor={labelId}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3',
                      isMemberOwner ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50',
                    )}
                  >
                    <input
                      id={labelId}
                      type="checkbox"
                      checked={isChecked}
                      disabled={isMemberOwner || isUpdating}
                      onChange={(event) => handleToggle(member, event.target.checked)}
                      className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-950">{getMemberName(member)}</span>
                        <Badge variant={isMemberOwner ? 'warning' : 'default'}>{roleLabel(member.role)}</Badge>
                        {member.isActive === false ? <Badge variant="warning">غير نشط</Badge> : null}
                      </div>
                      <div className="mt-1 truncate text-xs font-semibold text-slate-500">
                        {member.email || member.phone || 'لا توجد بيانات تواصل'}
                      </div>
                      {isMemberOwner ? (
                        <div className="mt-1 text-xs font-bold text-amber-700">
                          المالك لديه كل الصلاحيات تلقائيًا
                        </div>
                      ) : null}
                    </div>
                    {isUpdating ? <span className="text-xs font-bold text-slate-400">جار الحفظ…</span> : null}
                  </label>
                );
              })}
            </div>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
