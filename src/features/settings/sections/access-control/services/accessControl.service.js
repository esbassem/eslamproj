import { requireSupabase } from '@/core/lib/supabase';

const mapUser = (x) => ({ id: x.id, tenantId: x.tenant_id, fullName: x.full_name || '', email: x.email || '', phone: x.phone || '', role: x.role || 'staff', isActive: x.is_active !== false });
const mapGroup = (x) => ({ id: x.id, name: x.name, code: x.code, description: x.description || '', active: x.active !== false });

async function queryOrThrow(query) { const { data, error, count } = await query; if (error) throw error; return { data: data || [], count }; }

export const accessControlService = {
  async listUsers(tenantId) {
    const client = requireSupabase();
    const [{ data: users }, { data: memberships }, { data: defaults }, { data: branches }] = await Promise.all([
      queryOrThrow(client.from('tenant_users').select('id,tenant_id,full_name,email,phone,role,is_active').eq('tenant_id', tenantId).order('full_name')),
      queryOrThrow(client.from('res_users_groups').select('user_id,group:res_groups(name)').eq('tenant_id', tenantId)),
      queryOrThrow(client.from('user_operational_defaults').select('user_id,default_branch_id').eq('tenant_id', tenantId)),
      queryOrThrow(client.from('branches').select('id,name').eq('tenant_id', tenantId)),
    ]);
    const counts = memberships.reduce((m, x) => m.set(x.user_id, (m.get(x.user_id) || 0) + 1), new Map());
    const groupNames = memberships.reduce((m,x)=>{const names=m.get(x.user_id)||[];if(x.group?.name)names.push(x.group.name);m.set(x.user_id,names);return m},new Map());
    const def = new Map(defaults.map((x) => [x.user_id, x.default_branch_id])); const branch = new Map(branches.map((x) => [x.id, x.name]));
    return users.map(mapUser).map((x) => ({ ...x, groupCount: counts.get(x.id) || 0, groupNames:groupNames.get(x.id)||[], defaultBranchName: branch.get(def.get(x.id)) || '' }));
  },
  async loadUserDetails(tenantId, userId) {
    const c = requireSupabase();
    const requests = [
      c.from('res_groups').select('id,name,code,description,active').or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order('name'),
      c.from('res_users_groups').select('id,user_id,group_id').eq('tenant_id', tenantId).eq('user_id', userId),
      c.from('branches').select('id,name,is_active').eq('tenant_id', tenantId).order('name'),
      c.from('pos_configs').select('id,name,branch_id,is_active').eq('tenant_id', tenantId).order('name'),
      c.from('stock_locations').select('id,name,code,branch_id,is_active').eq('tenant_id', tenantId).order('name'),
      c.from('user_branch_access').select('id,branch_id').eq('tenant_id', tenantId).eq('user_id', userId),
      c.from('user_pos_access').select('id,pos_id,branch_id').eq('tenant_id', tenantId).eq('user_id', userId),
      c.from('user_stock_location_access').select('id,stock_location_id,branch_id').eq('tenant_id', tenantId).eq('user_id', userId),
      c.from('user_account_access').select('id,account_id').eq('tenant_id', tenantId).eq('user_id', userId),
      c.from('user_operational_defaults').select('default_branch_id,default_pos_id,default_stock_location_id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
      c.from('auth_group_permissions').select('group_id,permission:auth_permissions(code,action,active)'),
      c.from('tenant_modules').select('module:ir_modules(id,technical_name,name)').eq('tenant_id', tenantId).eq('state', 'installed'),
    ];
    const results = await Promise.all(requests); results.forEach(({ error }) => { if (error) throw error; });
    const memberGroups = new Set((results[1].data || []).map(x => x.group_id));
    const effectiveAccess = new Set((results[10].data || []).filter(x => memberGroups.has(x.group_id) && x.permission?.active && x.permission?.action === 'access').map(x => x.permission.code));
    return { groups: (results[0].data || []).map(mapGroup), memberships: results[1].data || [], branches: results[2].data || [], poses: results[3].data || [], stocks: results[4].data || [], branchAccess: (results[5].data || []).map(x => ({ id:x.id, branchId:x.branch_id })), posAccess: (results[6].data || []).map(x => ({ id:x.id, posId:x.pos_id, branchId:x.branch_id })), stockAccess: (results[7].data || []).map(x => ({ id:x.id, stockLocationId:x.stock_location_id, branchId:x.branch_id })), accountAccess: (results[8].data || []).map(x => ({ id:x.id, accountId:x.account_id })), defaults: { defaultBranchId: results[9].data?.default_branch_id || '', defaultPosId: results[9].data?.default_pos_id || '', defaultStockLocationId: results[9].data?.default_stock_location_id || '' }, installedApps: (results[11].data || []).map(x => x.module).filter(Boolean).map(x => ({ ...x, hasAccess: effectiveAccess.has(`${x.technical_name}.access`) })) };
  },
  async listGroupSummaries(tenantId) {
    const c=requireSupabase(); const [groups,memberships,grants]=await Promise.all([
      queryOrThrow(c.from('res_groups').select('id,tenant_id,name,code,description,active,is_system,module:ir_modules(technical_name,name)').or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order('name')),
      queryOrThrow(c.from('res_users_groups').select('group_id,user_id').eq('tenant_id',tenantId)),
      queryOrThrow(c.from('auth_group_permissions').select('group_id,permission:auth_permissions(code,action,active)')),
    ]); const counts=memberships.data.reduce((m,x)=>m.set(x.group_id,(m.get(x.group_id)||0)+1),new Map()); const access=new Map(); grants.data.forEach(x=>{if(x.permission?.active&&x.permission.action==='access'){const a=access.get(x.group_id)||[];a.push(x.permission.code);access.set(x.group_id,a)}});
    return groups.data.map(x=>({...x,userCount:counts.get(x.id)||0,appPermissions:access.get(x.id)||[],permissionCount:grants.data.filter(g=>g.group_id===x.id&&g.permission?.active).length,isReadOnly:x.tenant_id===null}));
  },
  async loadGroupPermissionEditor({tenantId,groupId}) {
    const c=requireSupabase(); const [group,catalog,modules,memberships,grants,users]=await Promise.all([
      queryOrThrow(c.from('res_groups').select('id,tenant_id,name,code,description,active,is_system').eq('id',groupId).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).limit(1)),
      queryOrThrow(c.from('auth_permissions').select('id,code,name,description,resource,action,active,module_code,permission_type,sort_order').eq('active',true).order('sort_order').order('name')),
      queryOrThrow(c.from('ir_modules').select('technical_name,name').eq('application',true).eq('technical',false).eq('active',true)),
      queryOrThrow(c.from('res_users_groups').select('user_id,group_id').eq('tenant_id',tenantId)),
      queryOrThrow(c.from('auth_group_permissions').select('group_id,permission_id')),
      queryOrThrow(c.from('tenant_users').select('id,full_name,email,phone,role,is_active').eq('tenant_id',tenantId).order('full_name')),
    ]); if(!group.data[0]) throw new Error('تعذر العثور على المجموعة.'); const selected=grants.data.filter(x=>x.group_id===groupId).map(x=>x.permission_id); const memberIds=memberships.data.filter(x=>x.group_id===groupId).map(x=>x.user_id);
    return {group:group.data[0],permissions:catalog.data,modules:modules.data,memberships:memberships.data,grants:grants.data,users:users.data.map(mapUser),selectedPermissionIds:selected,memberIds};
  },
  async saveGroupPermissions({groupId,permissionIds}) { const {data,error}=await requireSupabase().rpc('set_tenant_group_permissions',{p_group_id:groupId,p_permission_ids:permissionIds}); if(error) throw error; return data||[]; },
  async createTenantGroup({name,description,active=true}) { const {data,error}=await requireSupabase().rpc('create_tenant_group',{p_name:name,p_description:description||null,p_active:active});if(error)throw error;return data; },
  async updateTenantGroup({groupId,name,description,active}) { const {data,error}=await requireSupabase().rpc('update_tenant_group',{p_group_id:groupId,p_name:name,p_description:description||null,p_active:active});if(error)throw error;return data; },
  async deleteTenantGroup(groupId) { const {data,error}=await requireSupabase().rpc('delete_tenant_group',{p_group_id:groupId});if(error)throw error;return data===true; },
  async loadPermissionCatalog() {
    const c=requireSupabase(); const [permissions,modules,grants]=await Promise.all([
      queryOrThrow(c.from('auth_permissions').select('id,code,name,description,resource,action,active,module_code,permission_type,sort_order').eq('active',true).order('module_code').order('permission_type').order('sort_order').order('name')),
      queryOrThrow(c.from('ir_modules').select('id,technical_name,name').eq('application',true).eq('technical',false).eq('active',true)),
      queryOrThrow(c.from('auth_group_permissions').select('permission_id,group:res_groups(id,name,code,tenant_id,is_system,active,members:res_users_groups(user_id))')),
    ]);
    const usage=new Map(); grants.data.forEach(row=>{if(!row.group)return;const current=usage.get(row.permission_id)||{groups:[],userIds:new Set()};current.groups.push(row.group);(row.group.members||[]).forEach(member=>current.userIds.add(member.user_id));usage.set(row.permission_id,current)});
    return {permissions:permissions.data,modules:modules.data,usage:new Map([...usage].map(([id,value])=>[id,{groups:value.groups,userCount:value.userIds.size}]))};
  },
  async saveDefaults({tenantId,userId,defaults}) { const c=requireSupabase(); const payload={tenant_id:tenantId,user_id:userId,default_branch_id:defaults.defaultBranchId||null,default_pos_id:defaults.defaultPosId||null,default_stock_location_id:defaults.defaultStockLocationId||null,updated_at:new Date().toISOString()}; const {error}=await c.from('user_operational_defaults').upsert(payload,{onConflict:'tenant_id,user_id'}); if(error) throw error; },
  async saveUserAccessPlan({tenantId,userId,original,next,owner=false}) {
    const c=requireSupabase();
    const difference=(before,after)=>{const keep=new Set(after);return before.filter(id=>!keep.has(id))};
    const remove=async(table,column,ids)=>{if(!ids.length)return;const {error}=await c.from(table).delete().eq('tenant_id',tenantId).eq('user_id',userId).in(column,ids);if(error)throw error};
    const add=async(table,column,ids,extra={})=>{if(!ids.length)return;const rows=ids.map(id=>({tenant_id:tenantId,user_id:userId,[column]:id,...(typeof extra==='function'?extra(id):extra)}));const {error}=await c.from(table).insert(rows);if(error)throw error};
    if(!owner){
      const removedBranches=difference(original.branchIds,next.branchIds);const removedPos=difference(original.posIds,next.posIds);const removedStocks=difference(original.stockIds,next.stockIds);
      if(removedBranches.includes(original.defaults.defaultBranchId)||removedPos.includes(original.defaults.defaultPosId)||removedStocks.includes(original.defaults.defaultStockLocationId)){await this.saveDefaults({tenantId,userId,defaults:{defaultBranchId:removedBranches.includes(original.defaults.defaultBranchId)?'':original.defaults.defaultBranchId,defaultPosId:removedBranches.includes(original.defaults.defaultBranchId)||removedPos.includes(original.defaults.defaultPosId)?'':original.defaults.defaultPosId,defaultStockLocationId:removedBranches.includes(original.defaults.defaultBranchId)||removedStocks.includes(original.defaults.defaultStockLocationId)?'':original.defaults.defaultStockLocationId}})}
      await remove('res_users_groups','group_id',difference(original.roleIds,next.roleIds));
      await add('res_users_groups','group_id',difference(next.roleIds,original.roleIds));
      await remove('user_pos_access','pos_id',removedPos);
      await remove('user_stock_location_access','stock_location_id',removedStocks);
      await remove('user_branch_access','branch_id',removedBranches);
      await add('user_branch_access','branch_id',difference(next.branchIds,original.branchIds));
      await add('user_pos_access','pos_id',difference(next.posIds,original.posIds),id=>({branch_id:next.posBranchById[id]}));
      await add('user_stock_location_access','stock_location_id',difference(next.stockIds,original.stockIds),id=>({branch_id:next.stockBranchById[id]}));
      await remove('user_account_access','account_id',difference(original.accountIds,next.accountIds));
      await add('user_account_access','account_id',difference(next.accountIds,original.accountIds));
    }
    await this.saveDefaults({tenantId,userId,defaults:next.defaults});
  },
  async searchAccounts({tenantId,term='',page=0,pageSize=25}) { const c=requireSupabase(); let q=c.from('account_accounts').select('id,code,name,account_type',{count:'exact'}).eq('tenant_id',tenantId).order('code').range(page*pageSize,(page+1)*pageSize-1); const clean=term.trim(); if(clean) q=q.or(`code.ilike.%${clean.replace(/[,%]/g,'')}%,name.ilike.%${clean.replace(/[,%]/g,'')}%`); const {data,error,count}=await q; if(error) throw error; return {items:data||[],count:count||0}; },
};
