// Storefront categories + category-aware vocabulary so the product/copy reads
// right for food AND non-food (collectible) sellers.

export type Category = "food" | "collectibles" | "apparel" | "art" | "other";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "food", label: "Food / Beverage" },
  { value: "collectibles", label: "Collectibles" },
  { value: "apparel", label: "Apparel / Merch" },
  { value: "art", label: "Art / Handmade Goods" },
  { value: "other", label: "Other" },
];

export const CATEGORY_VALUES: string[] = CATEGORIES.map((c) => c.value);

export function categoryLabel(cat?: string | null): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? "Other";
}

export function isFood(cat?: string | null): boolean {
  return (cat ?? "food") === "food";
}

/** Show the collectible-specific product fields (type/condition/rarity). */
export function showItemMeta(cat?: string | null): boolean {
  return !isFood(cat);
}

/** Category-aware labels so the UI never says "Menu" to a card seller, etc. */
export function vocab(cat?: string | null) {
  const food = isFood(cat);
  return {
    food,
    catalog: food ? "Menu" : "Items", // section heading
    itemsLabel: food ? "Menu items" : "Products",
    itemNoun: food ? "item" : "product",
    addAnother: food ? "+ Add another item" : "+ Add another product",
    photoHint: food
      ? "Add a real photo of each item, or pick an icon. Photos sell food best."
      : "Add a clear photo of each product, or pick an icon. Sharp photos sell collectibles.",
    itemPlaceholder: food ? "Item" : "Product",
  };
}
