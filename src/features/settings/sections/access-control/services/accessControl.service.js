import { requireSupabase } from '@/core/lib/supabase';

const mapUser = (x) => ({ id: x.id, tenantId: x.tenant_id, fullName: x.full_name || '', email: x.email || '', phone: x.phone || '', role: x.role || 'staff', isActive: x.is_active !== false });
const mapGroup = (x) => ({ id: x.id, name: x.name, code: x.code, description: x.description || '', active: x.active !== false });

async function queryOrThrow(query) { const { data, error, count } = await query; if (error) throw error; return { data: data || [], count }; }

export const accessControlService = {
  async listUsers(tenantId) {
    const client = requireSupabase();
    const [{ data: users }, { data: memberships }, { data: defaults }, { data: branches }] = await Promise.all([
      queryOrThrow(client.from('tenant_users').select('id,tenant_id,full_name,email,phone,role,is_active').eq('tenant_id', tenantId).order('full_name')),
      queryOrThrow(client.from('res_users_groups').select('user_id').eq('tenant_id', tenantId)),
      queryOrThrow(client.from('user_operational_defaults').select('user_id,default_branch_id').eq('tenant_id', tenantId)),
      queryOrThrow(client.from('branches').select('id,name').eq('tenant_id', tenantId)),
    ]);
    const counts = memberships.reduce((m, x) => m.set(x.user_id, (m.get(x.user_id) || 0) + 1), new Map());
    const def = new Map(defaults.map((x) => [x.user_id, x.default_branch_id])); const branch = new Map(branches.map((x) => [x.id, x.name]));
    return users.map(mapUser).map((x) => ({ ...x, groupCount: counts.get(x.id) || 0, defaultBranchName: branch.get(def.get(x.id)) || '' }));
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
    return {group:group.data[0],permissions:catalog.data,modules:modules.data,memberships:memberships.data,grants:grants.data,users:users.data,selectedPermissionIds:selected,memberIds};
  },
  async saveGroupPermissions({groupId,permissionIds}) { const {data,error}=await requireSupabase().rpc('set_tenant_group_permissions',{p_group_id:groupId,p_permission_ids:permissionIds}); if(error) throw error; return data||[]; },
  async createTenantGroup({name,description,active=true}) { const {data,error}=await requireSupabase().rpc('create_tenant_group',{p_name:name,p_description:description||null,p_active:active});if(error)throw error;return data; },
  async updateTenantGroup({groupId,name,description,active}) { const {data,error}=await requireSupabase().rpc('update_tenant_group',{p_group_id:groupId,p_name:name,p_description:description||null,p_active:active});if(error)throw error;return data; },
  async saveTenantGroupMembers({groupId,userIds}) { const {data,error}=await requireSupabase().rpc('set_tenant_group_members',{p_group_id:groupId,p_user_ids:userIds});if(error)throw error;return data||[]; },
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
  async toggle(table, keys, enabled) { const c=requireSupabase(); if (enabled) { const {error}=await c.from(table).insert(keys); if(error) throw error; } else { let q=c.from(table).delete(); Object.entries(keys).forEach(([k,v])=>{q=q.eq(k,v)}); const {error}=await q; if(error) throw error; } },
  toggleGroup({tenantId,userId,groupId,enabled}) { return this.toggle('res_users_groups',{tenant_id:tenantId,user_id:userId,group_id:groupId},enabled); },
  toggleBranch({tenantId,userId,branchId,enabled}) { return this.toggle('user_branch_access',{tenant_id:tenantId,user_id:userId,branch_id:branchId},enabled); },
  togglePos({tenantId,userId,posId,branchId,enabled}) { return this.toggle('user_pos_access',{tenant_id:tenantId,user_id:userId,pos_id:posId,branch_id:branchId},enabled); },
  toggleStock({tenantId,userId,stockLocationId,branchId,enabled}) { return this.toggle('user_stock_location_access',{tenant_id:tenantId,user_id:userId,stock_location_id:stockLocationId,branch_id:branchId},enabled); },
  toggleAccount({tenantId,userId,accountId,enabled}) { return this.toggle('user_account_access',{tenant_id:tenantId,user_id:userId,account_id:accountId},enabled); },
  async saveDefaults({tenantId,userId,defaults}) { const c=requireSupabase(); const payload={tenant_id:tenantId,user_id:userId,default_branch_id:defaults.defaultBranchId||null,default_pos_id:defaults.defaultPosId||null,default_stock_location_id:defaults.defaultStockLocationId||null,updated_at:new Date().toISOString()}; const {error}=await c.from('user_operational_defaults').upsert(payload,{onConflict:'tenant_id,user_id'}); if(error) throw error; },
  async searchAccounts({tenantId,term='',page=0,pageSize=25}) { const c=requireSupabase(); let q=c.from('account_accounts').select('id,code,name,account_type',{count:'exact'}).eq('tenant_id',tenantId).order('code').range(page*pageSize,(page+1)*pageSize-1); const clean=term.trim(); if(clean) q=q.or(`code.ilike.%${clean.replace(/[,%]/g,'')}%,name.ilike.%${clean.replace(/[,%]/g,'')}%`); const {data,error,count}=await q; if(error) throw error; return {items:data||[],count:count||0}; },
};
