import { useCallback, useEffect, useState } from 'react';
import { accessControlService } from '../services/accessControl.service';
import { friendlyAccessError } from '../utils/accessControl';

export function useUsers(tenantId, allowed) {
  const [state,setState]=useState({status:'idle',items:[],error:''});
  const load=useCallback(async()=>{if(!tenantId||!allowed)return; setState(s=>({...s,status:'loading',error:''})); try{setState({status:'ready',items:await accessControlService.listUsers(tenantId),error:''})}catch(e){setState({status:'error',items:[],error:friendlyAccessError(e,'تعذر تحميل المستخدمين.')})}},[tenantId,allowed]);
  useEffect(()=>{load()},[load]); return {...state,reload:load};
}

export function useUserAccess(tenantId,user) {
  const [state,setState]=useState({status:'idle',data:null,error:'',pending:''});
  const load=useCallback(async()=>{if(!tenantId||!user)return; setState(s=>({...s,status:'loading',error:''})); try{setState({status:'ready',data:await accessControlService.loadUserDetails(tenantId,user.id),error:'',pending:''})}catch(e){setState({status:'error',data:null,error:friendlyAccessError(e,'تعذر تحميل تفاصيل الوصول.'),pending:''})}},[tenantId,user?.id]);
  useEffect(()=>{load()},[load]);
  const mutate=async(key,operation)=>{if(state.pending)return false; setState(s=>({...s,pending:key,error:''})); try{await operation(); await load(); return true}catch(e){setState(s=>({...s,pending:'',error:friendlyAccessError(e)})); return false}};
  return {...state,reload:load,mutate};
}

export function useGroupSummaries(tenantId, allowed) {
  const [state,setState]=useState({status:'idle',items:[],error:''});
  const load=useCallback(async()=>{if(!tenantId||!allowed)return;setState(s=>({...s,status:'loading'}));try{setState({status:'ready',items:await accessControlService.listGroupSummaries(tenantId),error:''})}catch(e){setState({status:'error',items:[],error:friendlyAccessError(e,'تعذر تحميل المجموعات.')})}},[tenantId,allowed]); useEffect(()=>{load()},[load]); return {...state,reload:load};
}

export function useGroupPermissionEditor(tenantId, group) {
  const [state,setState]=useState({status:'idle',data:null,error:'',saving:false});
  const load=useCallback(async()=>{if(!tenantId||!group)return;setState(s=>({...s,status:'loading',error:''}));try{setState({status:'ready',data:await accessControlService.loadGroupPermissionEditor({tenantId,groupId:group.id}),error:'',saving:false})}catch(e){setState({status:'error',data:null,error:friendlyAccessError(e,'تعذر تحميل صلاحيات المجموعة.'),saving:false})}},[tenantId,group?.id]); useEffect(()=>{load()},[load]);
  const save=async(permissionIds)=>{if(state.saving||!state.data)return false;setState(s=>({...s,saving:true,error:''}));try{await accessControlService.saveGroupPermissions({groupId:group.id,permissionIds});setState(s=>({...s,saving:false,selectedPermissionIds:permissionIds,data:{...s.data,selectedPermissionIds:permissionIds,grants:[...s.data.grants.filter(x=>x.group_id!==group.id),...permissionIds.map(permission_id=>({group_id:group.id,permission_id}))]}}));return true}catch(e){setState(s=>({...s,saving:false,error:friendlyAccessError(e,'تعذر حفظ صلاحيات المجموعة.')}));return false}}; return {...state,load,save};
}

export function usePermissionCatalog(enabled) {
  const [state,setState]=useState({status:'idle',data:null,error:''});
  useEffect(()=>{let live=true;if(!enabled)return;setState(s=>({...s,status:'loading',error:''}));accessControlService.loadPermissionCatalog().then(data=>live&&setState({status:'ready',data,error:''})).catch(e=>live&&setState({status:'error',data:null,error:friendlyAccessError(e,'تعذر تحميل دليل الصلاحيات.')}));return()=>{live=false}},[enabled]); return state;
}
