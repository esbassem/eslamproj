import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');

test('Paperwork permission codes have one shared frontend source',()=>{
  const permissions=read('src/features/paperwork/authorization/paperworkPermissions.js');
  for(const code of ['SEND','RECEIVE','DELIVER','CANCEL','CORRECT','AUTHORIZE_RELEASE']) assert.match(permissions,new RegExp(`PAPERWORK_${code}`));
  assert.match(permissions,/REQUEST_ACTION_PERMISSIONS/);
});

test('request and document actions use action permissions instead of owner rendering',()=>{
  const requests=read('src/features/paperwork/requests/RequestActions.jsx');
  const documents=read('src/features/paperwork/documents/DocumentActions.jsx');
  assert.match(requests,/useAuthorization/);
  assert.match(documents,/useAuthorization/);
  assert.doesNotMatch(`${requests}\n${documents}`,/\bisOwner\b|tenantUser\.role/);
  for(const code of ['CANCEL','CORRECT','AUTHORIZE_RELEASE']) assert.match(documents,new RegExp(`PAPERWORK_PERMISSIONS\\.${code}`));
});

test('receive UI and Showroom creation use the approved capabilities',()=>{
  const home=read('src/features/paperwork/pages/PaperworkHomePage.jsx');
  const processor=read('src/features/paperwork/pages/PaperworkProcessorDetailsPage.jsx');
  const showroom=read('src/features/showroom/pages/ShowroomSellPage.jsx');
  assert.match(home,/PAPERWORK_PERMISSIONS\.RECEIVE/);
  assert.match(processor,/PAPERWORK_PERMISSIONS\.RECEIVE/);
  assert.match(showroom,/PAPERWORK_PERMISSIONS\.ACCESS/);
  assert.match(showroom,/PAPERWORK_PERMISSIONS\.SEND/);
});

test('permission denials use one Arabic error mapper',()=>{
  const mapper=read('src/features/paperwork/authorization/paperworkPermissions.js');
  assert.match(mapper,/ليس لديك صلاحية لتنفيذ هذا الإجراء/);
  assert.match(mapper,/42501/);
});
