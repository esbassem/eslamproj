import { requireSupabase } from '@/core/lib/supabase';

/**
 * In-memory cache: tenantId → { isInstalled: boolean, expiresAt: number }
 * TTL: 5 minutes. Invalidated on explicit call to invalidateInventoryCache().
 */
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateInventoryCache(tenantId) {
  if (tenantId) {
    _cache.delete(tenantId);
  } else {
    _cache.clear();
  }
}

/**
 * Returns true if the "inventory" module is installed for the given tenant.
 * Falls back to false on any error (permissive: do not block sales).
 */
export async function isInventoryInstalled(tenantId) {
  if (!tenantId) return false;

  const cached = _cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isInstalled;
  }

  try {
    const client = requireSupabase();
    const { data, error } = await client
      .from('tenant_modules')
      .select('id, ir_modules!inner(technical_name)')
      .eq('tenant_id', tenantId)
      .eq('state', 'installed')
      .eq('ir_modules.technical_name', 'inventory')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const isInstalled = Boolean(data);
    _cache.set(tenantId, { isInstalled, expiresAt: Date.now() + CACHE_TTL_MS });
    return isInstalled;
  } catch {
    // On failure, default to permissive (allow selling)
    return false;
  }
}

/**
 * Determines whether a product can be sold.
 *
 * @param {object} params
 * @param {object} params.product          - Product record (may contain allowNegativeStock)
 * @param {number} params.availableQty     - Current available quantity (from stock_quants)
 * @param {boolean} params.inventoryInstalled - Whether the inventory module is installed
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canSellProduct({ product, availableQty, inventoryInstalled }) {
  // Inventory app not installed → always allow (same as Odoo consumable / allow negative)
  if (!inventoryInstalled) {
    return { allowed: true, reason: '' };
  }

  // Explicit negative-stock permission on the product
  if (product?.allowNegativeStock === true || product?.allow_negative_stock === true) {
    return { allowed: true, reason: '' };
  }

  // Stock available
  if (Number(availableQty) > 0) {
    return { allowed: true, reason: '' };
  }

  return { allowed: false, reason: 'الكمية غير متوفرة' };
}
