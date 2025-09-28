import type { StoreSearchResult } from "../../store/types";
import SearchResultItem from "./SearchResultItem";

/**
 * Props for the SearchResultList component.
 */
interface SearchResultListProps {
  results: StoreSearchResult[];
}

/**
 * Renders the list of search results using SearchResultItem.
 * Displays a message if no results are found.
 * @param props - Component props including the array of search results.
 */
const SearchResultList = ({ results }: SearchResultListProps) => {
  if (results.length === 0) {
    return (
      <p class="text-gray-500 dark:text-gray-400 italic">No results found.</p>
    );
  }
  return (
    <div class="space-y-2">
      {results.map((result) => (
        <SearchResultItem result={result} />
      ))}
    </div>
  );
};

export default SearchResultList;
