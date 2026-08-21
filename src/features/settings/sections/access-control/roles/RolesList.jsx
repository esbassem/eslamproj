import { Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { DetailSkeleton, EmptyBlock, LoadError, StatusText } from '../shared/AccessControlPrimitives';

export function RolesList({ groups, onSelect, onCreate }) {
  if(groups.status==='loading')return <DetailSkeleton/>;
  if(groups.error)return <LoadError message={groups.error} onRetry={groups.reload}/>;
  const roles=groups.items.filter(x=>!x.isReadOnly);
  return <div className="space-y-4"><div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-black">الأدوار</h2><p className="mt-1 text-sm text-slate-500">اجمع صلاحيات العمل في أدوار واضحة ثم اسندها للمستخدمين.</p></div>{roles.length?<Button onClick={onCreate}><Plus className="h-4 w-4"/>إنشاء دور</Button>:null}</div>{!roles.length?<EmptyBlock title="لا توجد أدوار حتى الآن" description="أنشئ دورًا لتجميع الصلاحيات ثم اسنده للمستخدمين." action={onCreate} actionLabel="إنشاء دور"/>:<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">{roles.map((role,index)=><button key={role.id} type="button" onClick={()=>onSelect(role)} className={`grid w-full gap-3 px-4 py-4 text-right hover:bg-slate-50 md:grid-cols-[minmax(0,1.5fr)_auto_auto] md:items-center ${index?'border-t border-slate-100':''}`}><div className="min-w-0"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-600"/><p className="truncate font-black">{role.name}</p></div><p className="mt-1 truncate text-sm text-slate-500">{role.description||'لا يوجد وصف لهذا الدور.'}</p>{role.appPermissions?.length?<p className="mt-2 truncate text-xs text-slate-400">{role.appPermissions.map(code=>code.replace(/\.access$/,'')).join(' · ')}</p>:null}</div><p className="text-sm text-slate-600">{role.userCount} أعضاء · {role.permissionCount} صلاحيات</p><StatusText active={role.active}/></button>)}</div>}</div>;
}
