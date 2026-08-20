import { EMPTY_RESOURCE_SCOPE } from './scopes/scope.service.js';

export const INITIAL_AUTHORIZATION_STATE = Object.freeze({
  permissionCodes: Object.freeze([]),
  resourceScope: EMPTY_RESOURCE_SCOPE,
  status: 'idle',
  error: null,
});

export function beginAuthorizationLoad(canLoad) {
  return {
    permissionCodes: [],
    resourceScope: EMPTY_RESOURCE_SCOPE,
    status: canLoad ? 'loading' : 'idle',
    error: null,
  };
}

export function completeAuthorizationLoad(permissionCodes, resourceScope) {
  return {
    permissionCodes: Array.from(new Set((permissionCodes ?? []).filter(Boolean))),
    resourceScope: resourceScope ?? EMPTY_RESOURCE_SCOPE,
    status: 'ready',
    error: null,
  };
}

export function failAuthorizationLoad(error) {
  return {
    permissionCodes: [],
    resourceScope: EMPTY_RESOURCE_SCOPE,
    status: 'error',
    error,
  };
}
