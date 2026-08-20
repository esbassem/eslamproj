import { Badge } from '@/core/ui/badge';

export function PermissionSection({ title, permissions, selected, readOnly, onToggle }) {
  if (!permissions.length) return null;
  return <section className="space-y-2"><h4 className="text-xs font-black text-slate-500">{title}</h4>{permissions.map((permission)=><label key={permission.id} className={`flex gap-3 rounded-lg border bg-white px-3 py-2.5 ${readOnly?'opacity-75':'cursor-pointer hover:bg-slate-50'}`}><input type="checkbox" className="mt-1 h-4 w-4 accent-slate-900" checked={selected.has(permission.id)} disabled={readOnly} onChange={(event)=>onToggle(permission,event.target.checked)}/><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">{permission.name}{permission.permission_type==='app_access'?<Badge variant="accent">وصول للتطبيق</Badge>:null}</span>{permission.description?<span className="mt-1 block text-xs leading-5 text-slate-500">{permission.description}</span>:null}<span className="mt-1 block text-[10px] text-slate-400">{permission.code}</span></span></label>)}</section>;
}
