import { DiligenceScore, CategoryScore } from '@/types/diligence';

/**
 * Get the effective score for a category (considers manual override)
 */
export function getEffectiveScore(category: CategoryScore): number {
  return category.manualOverride !== undefined ? category.manualOverride : category.score;
}

/**
 * Recalculate overall score with manual overrides
 * Takes into account category weights and any manual overrides
 */
export function recalculateOverallScore(categories: CategoryScore[]): number {
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const category of categories) {
    const effectiveScore = getEffectiveScore(category);
    totalWeightedScore += effectiveScore * category.weight;
    totalWeight += category.weight;
  }

  // Normalize to 0-100 scale
  return totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
}

/**
 * Recalculate weighted scores for all categories
 * This should be called after any manual override is applied
 */
export function recalculateWeightedScores(categories: CategoryScore[]): CategoryScore[] {
  return categories.map(category => {
    const effectiveScore = getEffectiveScore(category);
    return {
      ...category,
      weightedScore: Number(((effectiveScore * category.weight) / 100).toFixed(2)),
    };
  });
}

/**
 * Apply a manual override to a specific category
 */
export function applyCategoryOverride(
  score: DiligenceScore,
  categoryName: string,
  overrideScore: number,
  reason?: string,
  suppressTopics?: string[]
): DiligenceScore {
  const updatedCategories = score.categories.map(category => {
    if (category.category === categoryName) {
      return {
        ...category,
        manualOverride: overrideScore,
        overrideReason: reason,
        overrideSuppressTopics: suppressTopics && suppressTopics.length > 0 ? suppressTopics : undefined,
        overridedAt: new Date().toISOString(),
      };
    }
    return category;
  });

  // Recalculate weighted scores
  const recalculatedCategories = recalculateWeightedScores(updatedCategories);

  // Recalculate overall score
  const newOverall = recalculateOverallScore(recalculatedCategories);

  return {
    ...score,
    overall: newOverall,
    categories: recalculatedCategories,
  };
}

/**
 * Remove a manual override from a category (revert to AI score)
 */
export function removeCategoryOverride(
  score: DiligenceScore,
  categoryName: string
): DiligenceScore {
  const updatedCategories = score.categories.map(category => {
    if (category.category === categoryName) {
      const { manualOverride, overrideReason, overrideSuppressTopics, overridedAt, ...rest } = category;
      return rest;
    }
    return category;
  });

  // Recalculate weighted scores
  const recalculatedCategories = recalculateWeightedScores(updatedCategories);

  // Recalculate overall score
  const newOverall = recalculateOverallScore(recalculatedCategories);

  return {
    ...score,
    overall: newOverall,
    categories: recalculatedCategories,
  };
}

/**
 * Check if a score has any manual overrides
 */
export function hasManualOverrides(score: DiligenceScore): boolean {
  return score.categories.some(category => category.manualOverride !== undefined);
}

/**
 * Get count of manual overrides
 */
export function getOverrideCount(score: DiligenceScore): number {
  return score.categories.filter(category => category.manualOverride !== undefined).length;
}
