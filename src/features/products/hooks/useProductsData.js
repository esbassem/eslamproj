import { useCallback, useEffect, useState } from 'react';
import {
  productAttributeService,
  productCategoryAttributeService,
  productCategoryTrackingIdentifierService,
  productAttributeValueService,
  productCategoryService,
  productTrackingIdentifierService,
  productsService,
} from '@/features/products/api/products.api';

const EMPTY_STATE = {
  products: [],
  categories: [],
  attributes: [],
  attributeValues: [],
  trackingIdentifierTypes: [],
};

function attachCategoryAttributeLinks({ categories, attributes, links }) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const normalizedLinks = [...links].sort((left, right) => {
    const orderDiff = (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return String(attributesById.get(left.attributeId)?.name ?? '').localeCompare(String(attributesById.get(right.attributeId)?.name ?? ''));
  });

  const categoryLinksByCategoryId = normalizedLinks.reduce((map, link) => {
    const current = map.get(link.categoryId) ?? [];
    current.push({
      ...link,
      attribute: attributesById.get(link.attributeId) ?? null,
      attributeName: attributesById.get(link.attributeId)?.name ?? '',
    });
    map.set(link.categoryId, current);
    return map;
  }, new Map());

  const categoryLinksByAttributeId = normalizedLinks.reduce((map, link) => {
    const current = map.get(link.attributeId) ?? [];
    current.push({
      ...link,
      category: categoriesById.get(link.categoryId) ?? null,
      categoryName: categoriesById.get(link.categoryId)?.name ?? '',
    });
    map.set(link.attributeId, current);
    return map;
  }, new Map());

  return {
    categories: categories.map((category) => ({
      ...category,
      attributeLinks: categoryLinksByCategoryId.get(category.id) ?? [],
    })),
    attributes: attributes.map((attribute) => ({
      ...attribute,
      categoryLinks: categoryLinksByAttributeId.get(attribute.id) ?? [],
      categoryIds: (categoryLinksByAttributeId.get(attribute.id) ?? []).map((link) => link.categoryId),
    })),
  };
}

function attachCategoryTrackingIdentifierLinks({ categories, trackingIdentifierTypes, links }) {
  const typesById = new Map(trackingIdentifierTypes.map((type) => [type.id, type]));
  const normalizedLinks = [...links].sort((left, right) => {
    const orderDiff = (left.sequence ?? 0) - (right.sequence ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return String(typesById.get(left.identifierTypeId)?.name ?? '').localeCompare(String(typesById.get(right.identifierTypeId)?.name ?? ''));
  });

  const linksByCategoryId = normalizedLinks.reduce((map, link) => {
    const current = map.get(link.categoryId) ?? [];
    current.push({
      ...link,
      identifierType: typesById.get(link.identifierTypeId) ?? null,
      identifierTypeName: typesById.get(link.identifierTypeId)?.name ?? '',
    });
    map.set(link.categoryId, current);
    return map;
  }, new Map());

  return categories.map((category) => ({
    ...category,
    trackingIdentifierLinks: linksByCategoryId.get(category.id) ?? [],
  }));
}

export function useProductsData(tenantId) {
  const [data, setData] = useState(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!tenantId) {
      setData(EMPTY_STATE);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const [products, categories, attributes, attributeValues, categoryAttributeLinks, trackingIdentifierTypes, categoryTrackingIdentifierLinks] = await Promise.all([
        productsService.listProducts(tenantId),
        productCategoryService.listCategories(tenantId),
        productAttributeService.listAttributes(tenantId),
        productAttributeValueService.listValues(tenantId),
        productCategoryAttributeService.listLinks(tenantId),
        productTrackingIdentifierService.listTypes(tenantId),
        productCategoryTrackingIdentifierService.listLinks(tenantId),
      ]);
      const linkedData = attachCategoryAttributeLinks({ categories, attributes, links: categoryAttributeLinks });
      const categoriesWithTrackingIdentifiers = attachCategoryTrackingIdentifierLinks({
        categories: linkedData.categories,
        trackingIdentifierTypes,
        links: categoryTrackingIdentifierLinks,
      });

      setData({
        products,
        categories: categoriesWithTrackingIdentifiers,
        attributes: linkedData.attributes,
        attributeValues,
        trackingIdentifierTypes,
      });
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل بيانات المنتجات.');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!tenantId) {
        if (mounted) setData(EMPTY_STATE);
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        const [products, categories, attributes, attributeValues, categoryAttributeLinks, trackingIdentifierTypes, categoryTrackingIdentifierLinks] = await Promise.all([
          productsService.listProducts(tenantId),
          productCategoryService.listCategories(tenantId),
          productAttributeService.listAttributes(tenantId),
          productAttributeValueService.listValues(tenantId),
          productCategoryAttributeService.listLinks(tenantId),
          productTrackingIdentifierService.listTypes(tenantId),
          productCategoryTrackingIdentifierService.listLinks(tenantId),
        ]);
        const linkedData = attachCategoryAttributeLinks({ categories, attributes, links: categoryAttributeLinks });
        const categoriesWithTrackingIdentifiers = attachCategoryTrackingIdentifierLinks({
          categories: linkedData.categories,
          trackingIdentifierTypes,
          links: categoryTrackingIdentifierLinks,
        });

        if (!mounted) return;

        setData({
          products,
          categories: categoriesWithTrackingIdentifiers,
          attributes: linkedData.attributes,
          attributeValues,
          trackingIdentifierTypes,
        });
      } catch (loadError) {
        if (mounted) setError(loadError.message || 'تعذر تحميل بيانات المنتجات.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  return {
    ...data,
    isLoading,
    error,
    reload,
  };
}
