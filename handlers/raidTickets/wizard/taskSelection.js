import { getRaidWizardCategoryDef } from '../embeds/raidWizardUi.js';

export function expandWizardTaskSelection(rawSelected = [], categoryKeys = []) {
  const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
  const allTasksForAllCategories = [...new Set(categories.flatMap((c) => c.tasks))];

  if (rawSelected.includes('__all_selected__')) {
    return allTasksForAllCategories;
  }

  const perCategoryAll = rawSelected
    .filter((v) => v.startsWith('__all__:'))
    .map((v) => v.slice('__all__:'.length));

  const expanded = perCategoryAll.flatMap((catKey) => getRaidWizardCategoryDef(catKey)?.tasks ?? []);
  const explicit = rawSelected.filter((v) => !v.startsWith('__all__:') && v !== '__all_selected__');
  return [...new Set([...expanded, ...explicit])].filter(Boolean);
}
