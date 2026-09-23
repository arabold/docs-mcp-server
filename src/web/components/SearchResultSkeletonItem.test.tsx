import { describe, expect, test } from 'vitest';
import SearchResultSkeletonItem from './SearchResultSkeletonItem';

describe('src/web/components/SearchResultSkeletonItemts', () => {
  test('it renders three skeleton bars', () => {
    const html = SearchResultSkeletonItem() as string;
    // Count how many gray-200 divs are inside
    const barCount = (html.match(/<div.+?bg-gray-200/g) ?? []).length;
    expect(barCount).toBe(3);
  });
});
