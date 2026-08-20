import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { accessControlService } from '../services/accessControl.service';
import { AccessCheck, AccessSection } from './AccessSection';

export function AccountsAccess({ tenantId, userId, details, pending, mutate }) {
  const [term,setTerm]=useState(''); const [page,setPage]=useState(0); const [state,setState]=useState({loading:true,items:[],count:0,error:''});
  useEffect(()=>{let live=true; const timer=setTimeout(async()=>{setState(s=>({...s,loading:true,error:''})); try{const x=await accessControlService.searchAccounts({tenantId,term,page}); if(live)setState({loading:false,...x,error:''})}catch{if(live)setState({loading:false,items:[],count:0,error:'تعذر تحميل الحسابات.'})}},250); return()=>{live=false;clearTimeout(timer)}},[tenantId,term,page]);
  const selected=new Set(details.accountAccess.map(x=>x.accountId));
  return <AccessSection title="الحسابات المسموحة" description="ابحث بالكود أو اسم الحساب. لا يرتبط الوصول بحقل الموظف المسؤول."><Input value={term} onChange={e=>{setTerm(e.target.value);setPage(0)}} placeholder="بحث في الحسابات..."/>{state.loading?<p className="py-4 text-center text-sm text-slate-500">جاري التحميل...</p>:null}{state.error?<p className="text-sm text-red-600">{state.error}</p>:null}{!state.loading&&state.items.length===0?<p className="py-4 text-center text-sm text-slate-500">لا توجد نتائج.</p>:null}{state.items.map(a=><AccessCheck key={a.id} label={`${a.code || '—'} — ${a.name}`} hint={a.account_type} checked={selected.has(a.id)} pending={pending===`account:${a.id}`} onChange={enabled=>mutate(`account:${a.id}`,()=>accessControlService.toggleAccount({tenantId,userId,accountId:a.id,enabled}))}/>)}<div className="flex items-center justify-between pt-2"><Button size="sm" variant="secondary" disabled={page===0||state.loading} onClick={()=>setPage(p=>p-1)}>السابق</Button><span className="text-xs text-slate-500">{state.count} حساب</span><Button size="sm" variant="secondary" disabled={(page+1)*25>=state.count||state.loading} onClick={()=>setPage(p=>p+1)}>التالي</Button></div></AccessSection>;
}
